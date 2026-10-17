import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { acquireLock, releaseLock, retryAfterMs } from '../../src/infrastructure/workspace/lock.ts';
import { hostIdentity } from '../../src/infrastructure/workspace/lock-holder.ts';
import { encodeText } from '../../src/infrastructure/documents/codec.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';

let root: string, lock: string, identity: Awaited<ReturnType<typeof hostIdentity>>;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'forge-lock-wait-'))); lock = join(root, '.agent-cli.lock');
  identity = await hostIdentity();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const write = (path: string, text = 'Hello') => ({ path, bytes: encodeText(text) });
const holder = (fields: Record<string, unknown>) => JSON.stringify({ hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', command: 'write', forgeVersion: '0.1.0', ...identity, ...fields });
/** The parent of this test worker is alive and is not this process: its lock is held by a running writer. */
const active = () => holder({ pid: process.ppid });
const exitedPid = () => spawnSync(process.execPath, ['-e', '']).pid!;
const elapsed = async (run: () => Promise<unknown>) => { const started = Date.now(); await run().catch(() => {}); return Date.now() - started; };

describe('waiting for another writer', () => {
  it('fails at once without --wait and suggests when to retry', async () => {
    await writeFile(lock, active());
    const files = await NodeFiles.at(root);
    const error = await files.writeBatch([write('a.md')], false).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: 'WORKSPACE_BUSY', retryable: true, details: { stale: 'active', retryAfterMs } });
    expect((error as { details: object }).details).not.toHaveProperty('waitedMs');
  });

  it('takes the lock once its holder releases it within the budget', async () => {
    await writeFile(lock, active());
    const files = await NodeFiles.at(root, undefined, undefined, () => 5000);
    setTimeout(() => { void unlink(lock); }, 150);
    const result = await files.writeBatch([write('a.md')], false);
    expect(result.changes.map(change => change.operation)).toEqual(['created']);
    expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('Hello');
    expect(await readdir(root)).toEqual(['a.md']);
  });

  it('gives up after the budget and reports how long it waited', async () => {
    await writeFile(lock, active());
    const files = await NodeFiles.at(root, undefined, undefined, () => 300);
    const started = Date.now();
    const error = await files.writeBatch([write('a.md')], false).catch((failure: unknown) => failure);
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
    expect(error).toMatchObject({ code: 'WORKSPACE_BUSY', retryable: true, details: { stale: 'active', retryAfterMs, waitedMs: expect.any(Number) } });
    expect((error as { details: { waitedMs: number } }).details.waitedMs).toBeGreaterThanOrEqual(290);
    expect(await readdir(root)).toEqual(['.agent-cli.lock']);
  });

  it('never waits for a lock that needs a person', async () => {
    await writeFile(lock, holder({ pid: exitedPid(), hostname: `${hostname()}-elsewhere` }));
    const files = await NodeFiles.at(root, undefined, undefined, () => 60_000);
    expect(await elapsed(() => files.writeBatch([write('a.md')], false))).toBeLessThan(5000);
    const error = await files.writeBatch([write('a.md')], false).catch((failure: unknown) => failure) as { retryable: boolean; details: object };
    expect(error).toMatchObject({ code: 'WORKSPACE_BUSY', retryable: false, details: { stale: 'unknown' } });
    expect(error.details).not.toHaveProperty('retryAfterMs');
  });

  it('queues commits of one process even without a budget', async () => {
    const files = await NodeFiles.at(root);
    const results = await Promise.allSettled(['a', 'b', 'c', 'd', 'e', 'f'].map(name => files.writeBatch([write(`${name}.md`, name)], false)));
    expect(results.map(result => result.status)).toEqual(Array(6).fill('fulfilled'));
    expect((await readdir(root)).sort()).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md']);
  });
});

describe('folders holding the writer lock of a nested root', () => {
  const nested = async (content: string) => {
    await mkdir(join(root, 'src/inner'), { recursive: true });
    await writeFile(join(root, 'src/inner/note.md'), 'inner');
    await writeFile(join(root, 'src/inner/.agent-cli.lock'), content);
  };

  it.each([['running', active, true], ['unverifiable', () => holder({ pid: exitedPid(), hostname: `${hostname()}-elsewhere` }), false]] as const)(
    'refuses to move or delete a folder whose nested lock holder is %s', async (label, record, retryable) => {
      const content = record();
      await nested(content);
      const files = await NodeFiles.at(root);
      const { revision } = await files.stat('src');
      const nestedWriter = label === 'running' ? { nestedWriter: 'running' } : {};
      for (const dryRun of [true, false]) {
        await expect(files.commit({ renames: [{ from: 'src', to: 'moved', expectedRevision: revision }] }, dryRun)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', retryable, details: { path: 'src/inner/.agent-cli.lock', ...nestedWriter } });
        await expect(files.commit({ removes: [{ path: 'src/inner', expectedRevision: (await files.stat('src/inner')).revision }] }, dryRun)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
      }
      expect(await readFile(join(root, 'src/inner/.agent-cli.lock'), 'utf8')).toBe(content);
      expect((await readdir(root)).sort()).toEqual(['src']);
    });

  it('refuses while a nested root of this process holds its lock, and moves the folder once it is released', async () => {
    await mkdir(join(root, 'src/inner'), { recursive: true });
    const inner = join(root, 'src/inner/.agent-cli.lock');
    const token = await acquireLock(inner, () => ({ command: 'write' }));
    const files = await NodeFiles.at(root);
    const { revision } = await files.stat('src');
    await expect(files.commit({ renames: [{ from: 'src', to: 'moved', expectedRevision: revision }] }, false)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', details: { stale: 'active' } });
    await releaseLock(inner, token);
    const moved = await files.commit({ renames: [{ from: 'src', to: 'moved', expectedRevision: (await files.stat('src')).revision }] }, false);
    expect(moved.renames[0]).toMatchObject({ from: 'src', to: 'moved', kind: 'folder' });
  });

  it('fails at once whatever the --wait budget, with a hint that does not promise --wait', async () => {
    await nested(active());
    const files = await NodeFiles.at(root, undefined, undefined, () => 60_000);
    const { revision } = await files.stat('src');
    const started = Date.now();
    const error = await files.commit({ renames: [{ from: 'src', to: 'moved', expectedRevision: revision }] }, false).catch((failure: unknown) => failure);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(error).toMatchObject({ code: 'WORKSPACE_BUSY', retryable: true, details: { stale: 'active', nestedWriter: 'running', retryAfterMs } });
    for (const language of ['en', 'de'] as const) {
      const { hint } = new Localizer(language).error(error);
      expect(hint).toContain('--wait');
      expect(hint).not.toMatch(/rerun with --wait|mit --wait <ms>/);
    }
  });

  it('moves a folder whose nested lock is provably stale', async () => {
    await nested(holder({ pid: exitedPid() }));
    const files = await NodeFiles.at(root);
    const { revision } = await files.stat('src');
    await files.commit({ renames: [{ from: 'src', to: 'moved', expectedRevision: revision }] }, false);
    expect(await readFile(join(root, 'moved/inner/note.md'), 'utf8')).toBe('inner');
  });
});
