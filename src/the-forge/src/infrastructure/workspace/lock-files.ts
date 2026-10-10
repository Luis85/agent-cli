import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ReleaseLock } from '../../application/plugins/core-plugins.ts';
import { NodeFiles } from './files.ts';
import { acquireLock, releaseLock } from './lock.ts';

/**
 * Lock files below `root` by root-relative path, created like the workspace writer lock (holder record written and
 * fsynced before the lock appears) and resolved with the repository's symlink and regular-file checks.
 */
export function nodeLockFiles(root: string): (path: string, command: string) => Promise<ReleaseLock> {
  return async (path, command) => {
    const target = await (await NodeFiles.at(root)).resolvePath(path);
    await mkdir(dirname(target), { recursive: true });
    const token = await acquireLock(target, () => ({ command }), `Lock ${path}`);
    return async () => (await releaseLock(target, token)) === 'released';
  };
}
