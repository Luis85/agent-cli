import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

/**
 * The canonical working directory when it lies outside the canonical workspace `root`, else undefined. Relative
 * paths always resolve against the workspace root, so a command run from elsewhere may not touch what its caller
 * expects. A working directory that no longer exists counts as outside.
 */
export async function workingDirectoryOutside(root: string, cwd: string): Promise<string | undefined> {
  const canonical = await realpath(cwd).catch(() => cwd);
  const path = relative(root, canonical);
  const inside = path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
  return inside ? undefined : canonical;
}
