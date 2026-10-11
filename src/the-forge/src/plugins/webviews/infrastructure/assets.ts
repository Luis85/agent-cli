import { lstat, open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ensureWebview } from '../domain/errors.ts';
import { vaultPath, type FileSnapshot } from '../../../domain/documents/file.ts';
import type { ReadWebviewAssets } from '../application/publish.ts';

/** Built assets only: never follow source links, consume pipes or publish hidden development files. */
export const readWebviewAssets: ReadWebviewAssets = async (root, relative) => {
  const directory = join(root, vaultPath(relative));
  let parent = root;
  for (const segment of relative.split('/').slice(0, -1)) {
    parent = join(parent, segment);
    const info = await lstat(parent).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) return null;
    ensureWebview(info.isDirectory() && !info.isSymbolicLink(), 'WEBVIEW_INVALID', `Webview assets require regular directories: ${relative}`);
  }
  const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) return null;
  ensureWebview(info.isDirectory() && !info.isSymbolicLink(), 'WEBVIEW_INVALID', 'dist must be a regular directory.');
  const files: FileSnapshot[] = [], names = new Set<string>();
  async function walk(parent: string, prefix = '') {
    const info = await lstat(parent);
    ensureWebview(info.isDirectory() && !info.isSymbolicLink(), 'WEBVIEW_INVALID', `Webview assets require regular directories: ${prefix || relative}`);
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const path = vaultPath(`${prefix}${entry.name}`), target = join(parent, entry.name);
      ensureWebview(!entry.name.startsWith('.') && !/[. ]$/.test(entry.name) && entry.name.toLowerCase() !== 'node_modules', 'WEBVIEW_INVALID', `Build assets must not contain hidden or reserved names: ${path}`);
      ensureWebview(!names.has(path.toLowerCase()), 'WEBVIEW_INVALID', `Build assets must have unique case-insensitive paths: ${path}`);
      names.add(path.toLowerCase());
      if (entry.isDirectory()) { await walk(target, `${path}/`); continue; }
      ensureWebview(entry.isFile(), 'WEBVIEW_INVALID', `Build assets must contain only regular files: ${path}`);
      ensureWebview(/\.(?:html|js|css|json|svg|png|jpe?g|webp|ico|woff2?)$/i.test(path) || path === 'THIRD-PARTY-NOTICES.md' || path.startsWith('licenses/'), 'WEBVIEW_INVALID', `Unsupported static build asset: ${path}`);
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        ensureWebview((await handle.stat()).isFile(), 'WEBVIEW_INVALID', `Build asset is not a regular file: ${path}`);
        const bytes = await handle.readFile();
        files.push({ path, bytes, revision: createHash('sha256').update(bytes).digest('hex') });
      } finally { await handle.close(); }
    }
  }
  await walk(directory);
  return files.sort((left, right) => left.path.localeCompare(right.path));
};
