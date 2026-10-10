import { stat } from 'node:fs/promises';
import type { FileDates } from '../../application/plugins/core-plugins.ts';
import { NodeFiles } from './files.ts';

/** File size and dates below `root`, resolved with the repository's symlink and regular-file checks. */
export function nodeFileDates(root: string): (path: string) => Promise<FileDates> {
  let files: Promise<NodeFiles> | undefined;
  return async path => {
    const info = await stat(await (await (files ??= NodeFiles.at(root))).resolvePath(path));
    return { size: info.size, ctime: info.birthtime, mtime: info.mtime };
  };
}
