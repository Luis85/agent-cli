import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { acquireLock, breakStale, hostIdentity, inspectLock, releaseLock } from '../../src/infrastructure/workspace/lock.ts';
import { encodeText } from '../../src/infrastructure/documents/codec.ts';

/**
 * A lock whose holder provably no longer runs (same host, pid namespace and boot, and a dead or reused pid; or a
 * lock written before this host's last boot) is broken atomically and reported; anything else is still refused.
 */
let root: string, lock: string, warnings: string[], files: NodeFiles, identity: Awaited<ReturnType<typeof hostIdentity>>;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'forge-lock-recovery-'))); lock = join(root, '.agent-cli.lock');
  warnings = []; files = await NodeFiles.at(root, message => warnings.push(message)); identity = await hostIdentity();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const write = (path: string) => ({ path, bytes: encodeText('Hello') });
const exitedPid = () => spawnSync(process.execPath, ['-e', '']).pid!;
const holder = (fields: Record<string, unknown>) => JSON.stringify({ hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', command: 'create', operationId: 2, forgeVersion: '0.1.0', ...identity, token: 'left-behind', ...fields });
const linux = (await hostIdentity()).bootId !== undefined;

describe('breaking a stale writer lock', () => {
  it('breaks a lock whose process no longer runs on this host and reports the removed holder', async () => {
    const pid = exitedPid();
    await writeFile(lock, holder({ pid }));
    await expect(files.writeBatch([write('note.md')], false)).resolves.toMatchObject({ changes: [{ operation: 'created' }] });
    expect(await readdir(root)).toEqual(['note.md']);
    expect(warnings).toEqual([expect.stringMatching(new RegExp(`Removed the stale lock \\.agent-cli\\.lock of pid ${pid} on ${hostname()}.*command create.*no longer runs`))]);
  });

  it('breaks a lock that names this process but is not held by it, as after a fixed-pid container restart', async () => {
    await writeFile(lock, holder({ pid: process.pid }));
    await expect(files.writeBatch([write('note.md')], false)).resolves.toBeDefined();
    expect(warnings).toEqual([expect.stringContaining(`pid ${process.pid}`)]);
  });

  it.runIf(linux)('breaks a lock whose pid now belongs to another process (the recorded start time differs)', async () => {
    await writeFile(lock, holder({ pid: process.ppid, processStart: '1' }));
    await expect(files.writeBatch([write('note.md')], false)).resolves.toBeDefined();
    expect(warnings).toEqual([expect.stringContaining('was reused by another process')]);
  });

  it.runIf(linux)('keeps a lock whose live process matches the recorded start time', async () => {
    const start = (await readFile(`/proc/${process.ppid}/stat`, 'utf8')).slice((await readFile(`/proc/${process.ppid}/stat`, 'utf8')).lastIndexOf(')') + 2).split(' ')[19];
    await writeFile(lock, holder({ pid: process.ppid, processStart: start }));
    await expect(files.writeBatch([write('note.md')], false)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', retryable: true, details: { stale: 'active', path: '.agent-cli.lock' } });
  });

  it.runIf(linux)('breaks a lock written on this host before its last boot', async () => {
    await writeFile(lock, holder({ pid: process.ppid, bootId: '00000000-0000-0000-0000-000000000000', startedAt: '2000-01-01T00:00:00.000Z' }));
    await expect(files.writeBatch([write('note.md')], false)).resolves.toBeDefined();
    expect(warnings).toEqual([expect.stringContaining('before this host restarted')]);
  });

  it.runIf(linux)('refuses a lock of another boot that claims to start after this boot, without asking for a retry', async () => {
    await writeFile(lock, holder({ pid: exitedPid(), bootId: '00000000-0000-0000-0000-000000000000', startedAt: new Date().toISOString() }));
    const failure = files.writeBatch([write('note.md')], false);
    await expect(failure).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', retryable: false, details: { stale: 'unknown', path: '.agent-cli.lock' } });
    await expect(failure).rejects.toThrow(/delete .*\.agent-cli\.lock/);
  });

  it.each([
    ['another host', { hostname: `${hostname()}-elsewhere` }],
    ['another pid namespace', { pidNamespace: 'pid:[1]' }],
  ])('refuses a lock from %s and names the file to delete once the holder is verified', async (_label, other) => {
    await writeFile(lock, holder({ pid: exitedPid(), ...other }));
    const failure = files.writeBatch([write('note.md')], false);
    await expect(failure).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', retryable: false, details: { stale: 'unknown', path: '.agent-cli.lock', lock: other } });
    await expect(failure).rejects.toThrow(/delete .*\.agent-cli\.lock/);
    expect(warnings).toEqual([]);
    expect(JSON.parse(await readFile(lock, 'utf8'))).toMatchObject(other);
  });

  it('lets exactly one of many concurrent contenders take a stale lock and leaves no guard or temporary files', async () => {
    for (let round = 0; round < 10; round++) {
      await writeFile(lock, holder({ pid: exitedPid() }));
      const recoveries: unknown[] = [];
      const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => acquireLock(lock, () => ({}), '.agent-cli.lock', recovered => recoveries.push(recovered))));
      const won = outcomes.flatMap(outcome => (outcome.status === 'fulfilled' ? [outcome.value] : []));
      expect(won).toHaveLength(1);
      for (const outcome of outcomes) if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ code: 'WORKSPACE_BUSY', retryable: true, details: { stale: 'active' } });
      // Exactly one contender removed the stale lock and reported it, whether or not it then took the lock.
      expect(recoveries).toEqual([expect.objectContaining({ reason: 'dead-process', holder: expect.objectContaining({ command: 'create' }) })]);
      expect(JSON.parse(await readFile(lock, 'utf8')).token).toBe(won[0]);
      expect(await releaseLock(lock, won[0]!)).toBe('released');
      expect(await readdir(root)).toEqual([]);
    }
  });

  it('never removes a lock that another contender took after the stale one was diagnosed', async () => {
    const stale = holder({ pid: exitedPid() });
    const token = await acquireLock(lock, () => ({ command: 'write' }));
    expect(await breakStale(lock, stale)).toEqual({ broken: false });
    expect(JSON.parse(await readFile(lock, 'utf8')).token).toBe(token);
    expect(await releaseLock(lock, token)).toBe('released');
    expect(await readdir(root)).toEqual([]);
  });

  it('asks for a retry, never for a deletion, while another live contender holds the break guard', async () => {
    const guard = join(root, '.agent-cli-tmp-break-.agent-cli.lock');
    await writeFile(guard, holder({ pid: process.ppid, command: 'break stale lock' }));
    await writeFile(lock, holder({ pid: exitedPid() }));
    const failure = await acquireLock(lock, () => ({})).then(() => new Error('acquired'), (error: unknown) => error as Error);
    expect(failure).toMatchObject({ code: 'WORKSPACE_BUSY', retryable: true, details: { stale: 'active', reason: 'dead-process', path: '.agent-cli.lock', breaker: { pid: process.ppid, command: 'break stale lock' } } });
    expect(failure.message).toMatch(/another Forge process .* is removing it/);
    expect(failure.message).not.toMatch(/delete/i);
    expect(await readdir(root)).toEqual(expect.arrayContaining(['.agent-cli.lock', '.agent-cli-tmp-break-.agent-cli.lock']));
  });

  it('names the break guard to delete once verified when its holder cannot be checked', async () => {
    await writeFile(join(root, '.agent-cli-tmp-break-.agent-cli.lock'), holder({ pid: exitedPid(), hostname: `${hostname()}-elsewhere`, command: 'break stale lock' }));
    await writeFile(lock, holder({ pid: exitedPid() }));
    const failure = files.writeBatch([write('note.md')], false);
    await expect(failure).rejects.toMatchObject({ code: 'WORKSPACE_BUSY', retryable: false, details: { stale: 'unknown', path: '.agent-cli-tmp-break-.agent-cli.lock' } });
    await expect(failure).rejects.toThrow(/delete \.agent-cli-tmp-break-\.agent-cli\.lock/);
  });

  it('never diagnoses a lock that its own process is releasing as stale', async () => {
    for (let round = 0; round < 50; round++) {
      const token = await acquireLock(lock, () => ({}));
      const release = releaseLock(lock, token);
      const seen = await inspectLock(lock);
      expect(await release).toBe('released');
      expect(seen.stale === 'stale' ? seen.reason : seen.stale).not.toBe('reused-pid');
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('breaks a break guard left by a contender that was killed while breaking', async () => {
    await writeFile(join(root, '.agent-cli-tmp-break-.agent-cli.lock'), holder({ pid: exitedPid(), command: 'break stale lock' }));
    await writeFile(lock, holder({ pid: exitedPid() }));
    await expect(files.writeBatch([write('note.md')], false)).resolves.toBeDefined();
    expect(await readdir(root)).toEqual(['note.md']);
  });
});
