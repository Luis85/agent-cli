import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import metadata from '../../package.json';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { acquireLock, hostIdentity, inspectLock, releaseLock } from '../../src/infrastructure/workspace/lock.ts';
import { encodeText } from '../../src/infrastructure/documents/codec.ts';

let root: string, lock: string, files: NodeFiles, identity: Awaited<ReturnType<typeof hostIdentity>>;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'forge-lock-'))); lock = join(root, '.agent-cli.lock'); files = await NodeFiles.at(root);
  identity = await hostIdentity();
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
const write = (path: string, text = 'Hello') => ({ path, bytes: encodeText(text) });
const exitedPid = () => {
  const child = spawnSync(process.execPath, ['-e', '']);
  expect(child.status).toBe(0);
  return child.pid!;
};
const holder = (fields: Record<string, unknown>) => JSON.stringify({ hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', command: 'write', operationId: 3, forgeVersion: '0.1.0', ...identity, ...fields });
/** Age a hand-written lock past the window in which an empty or partial lock counts as still being written. */
const aged = async (path: string) => { await utimes(path, 1_000_000, 1_000_000); };
type Adapter = { replace(target: string, bytes: Uint8Array, mode?: number, verify?: () => Promise<void>): Promise<void> };
const walk = async (directory: string, prefix = ''): Promise<string[]> => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry =>
  entry.isDirectory() ? walk(join(directory, entry.name), `${prefix}${entry.name}/`) : [prefix + entry.name]))).flat().sort();

describe('workspace writer lock diagnosis', () => {
  it('reports a likely stale lock when the recorded process no longer runs on this host', async () => {
    const pid = exitedPid();
    await writeFile(lock, holder({ pid }));
    const failure = files.writeBatch([write('note.md')], false);
    await expect(failure).rejects.toMatchObject({
      code: 'WORKSPACE_BUSY', exitCode: 4,
      details: { stale: 'likely', lock: { pid, hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', command: 'write', operationId: 3, forgeVersion: '0.1.0' } },
    });
    await expect(failure).rejects.toThrow(/stale.*likely/s);
    expect(await readdir(root)).toEqual(['.agent-cli.lock']);
    expect(await readFile(lock, 'utf8')).toBe(holder({ pid }));
  });
  it('reports an active holder when the recorded process is alive on this host', async () => {
    // The parent of this test worker is alive and is not this process.
    await writeFile(lock, holder({ pid: process.ppid }));
    await expect(files.writeBatch([write('note.md')], false)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', exitCode: 4, details: { stale: 'active', lock: { pid: process.ppid } } });
    expect(await readdir(root)).toEqual(['.agent-cli.lock']);
  });
  it('reports a lock naming this process but not held by it as likely stale, as after a fixed-pid container restart', async () => {
    await writeFile(lock, holder({ pid: process.pid, token: 'left-by-a-previous-run' }));
    await expect(files.writeBatch([write('note.md')], false)).rejects.toMatchObject({ details: { stale: 'likely', lock: { pid: process.pid } } });
  });
  it.each([
    ['pid namespace', { pidNamespace: 'pid:[1]' }],
    ['boot', { bootId: '00000000-0000-0000-0000-000000000000' }],
  ])('cannot call a lock from another %s likely stale, because its pid means another process', async (_label, other) => {
    await writeFile(lock, holder({ pid: exitedPid(), ...other }));
    await expect(files.writeBatch([write('note.md')], false)).rejects.toMatchObject({ details: { stale: 'unknown', lock: other } });
  });
  it('cannot diagnose a holder on another host', async () => {
    await writeFile(lock, holder({ pid: exitedPid(), hostname: `${hostname()}-elsewhere` }));
    await expect(files.writeBatch([write('note.md')], false)).rejects.toMatchObject({ details: { stale: 'unknown', lock: { hostname: `${hostname()}-elsewhere` } } });
  });
  it.each([
    ['empty legacy lock', ''],
    ['free text', 'existing owner'],
    ['invalid pid', holder({ pid: 0 })],
    ['negative pid', holder({ pid: -1 })],
    ['missing hostname', JSON.stringify({ pid: process.pid, startedAt: '2026-10-10T08:00:00.000Z' })],
    ['JSON array', '[1,2]'],
  ])('reports an unreadable %s as unknown without changing it', async (_label, content) => {
    await writeFile(lock, content);
    await aged(lock);
    const failure = files.writeBatch([write('note.md')], false);
    await expect(failure).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', details: { lock: null, stale: 'unknown' } });
    expect(await readFile(lock, 'utf8')).toBe(content);
  });
  it('reports a recent empty or partial lock as active, because its holder may still be writing it', async () => {
    await writeFile(lock, '{"pid":');
    await expect(files.writeBatch([write('note.md')], false)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', details: { lock: null, stale: 'active' } });
    expect(await readFile(lock, 'utf8')).toBe('{"pid":');
  });
  it('reports a non-file lock entry as unknown', async () => {
    await mkdir(lock);
    await expect(files.writeBatch([write('note.md')], false)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', details: { lock: null, stale: 'unknown' } });
  });
  it('returns only recognized metadata fields', async () => {
    await writeFile(lock, holder({ pid: process.pid, secret: 'value', token: 'release-token', command: 42, operationId: 'x' }));
    const { lock: recorded } = await inspectLock(lock);
    // The release token stays private to its writer.
    expect(recorded).toEqual({ pid: process.pid, hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', forgeVersion: '0.1.0', ...identity });
  });
  it('diagnoses removal against a held lock as well', async () => {
    await writeFile(join(root, 'note.md'), 'Hello');
    const before = await files.read('note.md');
    await writeFile(lock, holder({ pid: exitedPid() }));
    await expect(files.remove('note.md', before.revision, false)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', exitCode: 4, details: { stale: 'likely' } });
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('Hello');
  });
});

describe('owned writer lock', () => {
  it('records the holder as JSON while a batch is in progress', async () => {
    files = await NodeFiles.at(root, () => {}, () => ({ command: 'create', operationId: 7 }));
    const observed: unknown[] = [];
    const adapter = files as unknown as Adapter;
    const replace = adapter.replace.bind(files);
    vi.spyOn(adapter, 'replace').mockImplementation(async (...args) => {
      observed.push(JSON.parse(await readFile(lock, 'utf8')));
      await replace(...args);
    });
    const started = Date.now();
    await files.writeBatch([write('note.md')], false);
    expect(observed).toEqual([{ pid: process.pid, hostname: hostname(), startedAt: expect.any(String), command: 'create', operationId: 7, forgeVersion: metadata.version, ...identity, token: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
    const startedAt = Date.parse((observed[0] as { startedAt: string }).startedAt);
    expect(new Date(startedAt).toISOString()).toBe((observed[0] as { startedAt: string }).startedAt);
    expect(startedAt).toBeGreaterThanOrEqual(started - 1000);
  });
  it('omits invalid or failing owner details instead of failing the write', async () => {
    files = await NodeFiles.at(root, () => {}, () => { throw new Error('owner unavailable'); });
    const token = await acquireLock(lock, () => ({ command: '', operationId: -1 }));
    expect(JSON.parse(await readFile(lock, 'utf8'))).toEqual({ pid: process.pid, hostname: hostname(), startedAt: expect.any(String), forgeVersion: metadata.version, ...identity, token });
    expect(await releaseLock(lock, token)).toBe('released');
    await expect(files.writeBatch([write('note.md')], false)).resolves.toMatchObject([{ operation: 'created' }]);
  });
  it('acquires atomically and reports the existing holder', async () => {
    const token = await acquireLock(lock, () => ({ command: 'write' }));
    await expect(acquireLock(lock, () => ({ command: 'edit' }))).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', details: { stale: 'active', lock: { pid: process.pid, command: 'write' } } });
    expect(await releaseLock(lock, token)).toBe('released');
    expect(await releaseLock(lock, token)).toBe('missing');
    expect(await readdir(root)).toEqual([]);
  });
  it('leaves no lock or temporary files after successful creates, updates and removals', async () => {
    await files.writeBatch([write('a/b/c.md'), write('top.md')], false);
    const top = await files.read('top.md');
    await files.writeBatch([{ ...write('top.md', 'Changed'), expectedRevision: top.revision }, write('a/d.md')], false);
    const nested = await files.read('a/b/c.md');
    await files.remove('a/b/c.md', nested.revision, false);
    expect(await walk(root)).toEqual(['a/d.md', 'top.md']);
    expect(await readFile(join(root, 'top.md'), 'utf8')).toBe('Changed');
  });
  it('syncs every touched directory once before the batch resolves', async () => {
    const adapter = files as unknown as { syncDirectories(directories: Iterable<string>): Promise<void> };
    const synced: string[][] = [];
    const sync = adapter.syncDirectories.bind(files);
    vi.spyOn(adapter, 'syncDirectories').mockImplementation(async directories => { synced.push([...directories].sort()); await sync(directories); });
    await files.writeBatch([write('a/b/c.md'), write('a/b/d.md'), write('top.md')], false);
    expect(synced).toEqual([[root, join(root, 'a'), join(root, 'a/b')].sort()]);
    const top = await files.read('top.md');
    await files.remove('top.md', top.revision, false);
    expect(synced[1]).toEqual([root]);
  });
  it('stages every file durably before publishing any and removes staged files when one fails', async () => {
    await writeFile(join(root, 'existing.md'), 'Original');
    const before = await files.read('existing.md');
    const adapter = files as unknown as Adapter & { stage(target: string, bytes: Uint8Array, mode?: number): Promise<string> };
    const stage = adapter.stage.bind(files);
    vi.spyOn(adapter, 'stage').mockImplementation(async (target, ...args) => {
      if (basename(target) === 'broken.md') throw Object.assign(new Error('ENOSPC: injected'), { code: 'ENOSPC' });
      return stage(target, ...args);
    });
    const replace = vi.spyOn(adapter, 'replace');
    const plan = [write('a/b/one.md'), { ...write('existing.md', 'Changed'), expectedRevision: before.revision }, ...Array.from({ length: 12 }, (_, index) => write(`many/${index}.md`)), write('a/broken.md')];
    await expect(files.writeBatch(plan, false)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(replace).not.toHaveBeenCalled();
    expect(await walk(root)).toEqual(['existing.md']);
    expect(await readFile(join(root, 'existing.md'), 'utf8')).toBe('Original');
  });
  it('rolls back and reports a failed directory sync without leaving the lock', async () => {
    const adapter = files as unknown as { syncDirectories(directories: Iterable<string>): Promise<void> };
    vi.spyOn(adapter, 'syncDirectories').mockRejectedValueOnce(Object.assign(new Error('EIO: injected'), { code: 'EIO' }));
    await expect(files.writeBatch([write('a/note.md'), write('top.md')], false)).rejects.toMatchObject({ code: 'EIO' });
    expect(await walk(root)).toEqual([]);
  });
});
