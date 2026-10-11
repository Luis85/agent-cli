import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileDates } from '../../application/plugins/core-plugins.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { NodeFiles } from './files.ts';

/**
 * File size and dates below `root`, with the repository's symlink and regular-file checks. Each folder is checked
 * once (no segment a symlink or a file), and each file costs one `lstat`, so dating a whole vault stays linear.
 */
export function nodeFileDates(root: string): (path: string) => Promise<FileDates> {
  let files: Promise<NodeFiles> | undefined;
  const folders = new Map<string, Promise<string>>();
  const folder = (path: string) => {
    let checked = folders.get(path);
    if (checked === undefined) {
      checked = (files ??= NodeFiles.at(root)).then(async repository => {
        if (path === '') return repository.root;
        const absolute = await repository.resolvePath(path, true);
        // A missing folder fails at the file's lstat, as a missing file does; an existing one must be a folder.
        const info = await lstat(absolute).catch(() => null);
        ensure(info === null || info.isDirectory(), 'INVALID_PATH', `Not a regular file path: ${path}`);
        return absolute;
      });
      folders.set(path, checked);
    }
    return checked;
  };
  return async path => {
    const name = vaultPath(path).slice(path.lastIndexOf('/') + 1);
    const info = await lstat(join(await folder(path.slice(0, Math.max(0, path.lastIndexOf('/')))), name));
    ensure(!info.isSymbolicLink(), 'UNSAFE_PATH', `Symlinks are not supported: ${path}`);
    ensure(info.isFile(), 'INVALID_PATH', `Not a regular file path: ${path}`);
    return { size: info.size, ctime: info.birthtime, mtime: info.mtime };
  };
}
