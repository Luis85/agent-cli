import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Inject filesystem failures into the lock adapter while every other call uses the real filesystem. */
const faults = vi.hoisted(() => ({ link: undefined as string | undefined, openLock: undefined as string | undefined }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const fail = (code: string) => Promise.reject(Object.assign(new Error(`${code}: injected`), { code }));
  return {
    ...actual,
    link: (...args: Parameters<typeof actual.link>) => faults.link ? fail(faults.link) : actual.link(...args),
    open: (...args: Parameters<typeof actual.open>) => faults.openLock && String(args[0]).endsWith('.agent-cli.lock') && args[1] === 'wx'
      ? fail(faults.openLock) : actual.open(...args),
  };
});
const { NodeFiles } = await import('../../src/the-forge/infrastructure/workspace/files.ts');
const { acquireLock, releaseLock } = await import('../../src/the-forge/infrastructure/workspace/lock.ts');
const { encodeText } = await import('../../src/the-forge/infrastructure/documents/codec.ts');

let root: string, lock: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'forge-lock-owner-'))); lock = join(root, '.agent-cli.lock'); });
afterEach(async () => { faults.link = undefined; faults.openLock = undefined; vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
const write = (path: string) => ({ path, bytes: encodeText('Hello') });

describe('writer lock ownership', () => {
  it('never removes a lock that another writer replaced, and warns instead', async () => {
    const warnings: string[] = [];
    const files = await NodeFiles.at(root, message => warnings.push(message));
    const foreign = JSON.stringify({ pid: 1, hostname: 'elsewhere', startedAt: '2026-10-10T08:00:00.000Z', token: 'foreign' });
    const adapter = files as unknown as { stageAll(...args: unknown[]): Promise<void> };
    const stageAll = adapter.stageAll.bind(files);
    vi.spyOn(adapter, 'stageAll').mockImplementation(async (...args) => {
      // Someone deleted this writer's lock and another writer took it.
      await fs.rm(lock);
      await fs.writeFile(lock, foreign);
      await stageAll(...args);
    });
    await expect(files.writeBatch([write('note.md')], false)).resolves.toMatchObject([{ operation: 'created' }]);
    expect(await fs.readFile(lock, 'utf8')).toBe(foreign);
    expect(warnings).toEqual([expect.stringContaining("no longer carries this writer's token")]);
  });

  it('reports a release of a missing lock without failing', async () => {
    const token = await acquireLock(lock, () => ({}));
    await fs.rm(lock);
    expect(await releaseLock(lock, token)).toBe('missing');
  });

  it('publishes the complete holder record at once and leaves no temporary file', async () => {
    const token = await acquireLock(lock, () => ({ command: 'write' }));
    expect(JSON.parse(await fs.readFile(lock, 'utf8'))).toMatchObject({ pid: process.pid, command: 'write', token });
    expect(await fs.readdir(root)).toEqual(['.agent-cli.lock']);
    await expect(acquireLock(lock, () => ({}))).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
    expect(await fs.readdir(root)).toEqual(['.agent-cli.lock']);
    await releaseLock(lock, token);
  });

  it.each(['ENOTSUP', 'EPERM', 'EXDEV'])('falls back to an exclusive create when hard links fail with %s', async code => {
    faults.link = code;
    const files = await NodeFiles.at(root);
    await expect(files.writeBatch([write('note.md')], false)).resolves.toMatchObject([{ operation: 'created' }]);
    expect(await fs.readdir(root)).toEqual(['note.md']);
    const token = await acquireLock(lock, () => ({}));
    await expect(acquireLock(lock, () => ({}))).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', details: { stale: 'active' } });
    expect(await releaseLock(lock, token)).toBe('released');
  });

  it.each(['EPERM', 'EACCES'])('reports a lock that stays denied with %s (Windows delete-pending) as busy after retrying', async code => {
    Object.assign(faults, { link: 'EPERM', openLock: code });
    const files = await NodeFiles.at(root);
    await expect(files.writeBatch([write('note.md')], false)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', exitCode: 4 });
    expect(await fs.readdir(root)).toEqual([]);
  });
});
