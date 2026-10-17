import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReleaseLock } from '../../application/plugins/core-plugins.ts';
import type { KernelMessage } from '../../domain/shared/kernel-messages.ts';
import { NodeFiles } from './files.ts';
import { acquireLockWithin, recoveredLockMessage, releaseLock } from './lock.ts';

/**
 * Lock files below `root` by root-relative path, created like the workspace writer lock (holder record written and
 * fsynced before the lock appears) and resolved with the repository's symlink and regular-file checks. A stale lock
 * an acquisition removed is reported through `warn`. A held lock is waited for up to `wait()` milliseconds (`--wait`).
 */
export function nodeLockFiles(root: string, warn: (message: KernelMessage) => void, wait: () => number = () => 0): (path: string, command: string) => Promise<ReleaseLock> {
  return async (path, command) => {
    const target = await (await NodeFiles.at(root)).resolvePath(path);
    await mkdir(dirname(target), { recursive: true });
    const token = await acquireLockWithin(wait(), target, () => ({ command }), path, lock => warn(recoveredLockMessage(lock)));
    return async () => (await releaseLock(target, token)) === 'released';
  };
}
