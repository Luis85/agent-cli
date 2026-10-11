import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReleaseLock } from '../../application/plugins/core-plugins.ts';
import { NodeFiles, type RecoveredLockReport } from './files.ts';
import { acquireLock, recoveredLockMessage, releaseLock } from './lock.ts';

/**
 * Lock files below `root` by root-relative path, created like the workspace writer lock (holder record written and
 * fsynced before the lock appears) and resolved with the repository's symlink and regular-file checks. A stale lock
 * an acquisition removed is passed to `recovered`.
 */
export function nodeLockFiles(root: string, recovered: RecoveredLockReport): (path: string, command: string) => Promise<ReleaseLock> {
  return async (path, command) => {
    const target = await (await NodeFiles.at(root)).resolvePath(path);
    await mkdir(dirname(target), { recursive: true });
    const acquired = await acquireLock(target, () => ({ command }), path);
    if (acquired.recovered) recovered(acquired.recovered, recoveredLockMessage(acquired.recovered));
    return async () => (await releaseLock(target, acquired.token)) === 'released';
  };
}
