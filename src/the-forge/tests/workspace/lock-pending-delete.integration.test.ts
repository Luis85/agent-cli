import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * On Windows a file another process is deleting stays listed but cannot be opened (EPERM) until the deleting handle
 * closes. Inject that state into read-mode opens of one path, optionally removing the file afterwards.
 */
const faults = vi.hoisted(() => ({ path: undefined as string | undefined, failures: 0, thenRemove: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      if (faults.path !== undefined && String(args[0]) === faults.path && args[1] !== 'wx' && faults.failures > 0) {
        faults.failures--;
        if (faults.failures === 0 && faults.thenRemove) await actual.rm(faults.path, { force: true });
        throw Object.assign(new Error('EPERM: operation not permitted, open (delete pending)'), { code: 'EPERM' });
      }
      return actual.open(...args);
    },
  };
});
const { inspectLock } = await import('../../src/infrastructure/workspace/lock-holder.ts');
const { breakStale } = await import('../../src/infrastructure/workspace/lock.ts');

let root: string, lock: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'forge-lock-pending-'))); lock = join(root, '.agent-cli.lock'); });
afterEach(async () => { Object.assign(faults, { path: undefined, failures: 0, thenRemove: false }); await fs.rm(root, { recursive: true, force: true }); });

/** A holder record on this host; the pid is far beyond any running process. */
const holder = (fields: Record<string, unknown> = {}) => JSON.stringify({ pid: 2 ** 22 + 17, hostname: hostname(), startedAt: '2026-10-10T08:00:00.000Z', token: 'old', ...fields }) + '\n';

describe('a lock file another process is deleting', () => {
  it('reads as missing once the pending deletion completes, not as a lock Forge cannot verify', async () => {
    await fs.writeFile(lock, holder());
    Object.assign(faults, { path: lock, failures: 2, thenRemove: true });
    expect(await inspectLock(lock)).toMatchObject({ lock: null, missing: true });
  });

  it('is read normally once the deleting handle closes without removing it', async () => {
    await fs.writeFile(lock, holder({ command: 'write' }));
    Object.assign(faults, { path: lock, failures: 2 });
    expect((await inspectLock(lock)).lock).toMatchObject({ command: 'write' });
  });

  it('lets a contender that finds the break guard being deleted retry instead of failing as unverifiable', async () => {
    const stale = holder();
    await fs.writeFile(lock, stale);
    const guard = join(root, '.agent-cli-tmp-break-.agent-cli.lock');
    await fs.writeFile(guard, holder({ pid: process.pid, token: 'breaker' }));
    Object.assign(faults, { path: guard, failures: 1, thenRemove: true });
    expect(await breakStale(lock, stale)).toEqual({ broken: false });
  });
});
