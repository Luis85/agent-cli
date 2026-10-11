import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export interface WebviewAsset { id: string; name: string; directory: string }

/** Discover packaged views by manifest; missing optional view assets leave the server usable. */
export async function discoverWebviews(distributionPath: string): Promise<WebviewAsset[]> {
  const root = path.join(distributionPath, 'webviews');
  try {
    if ((await lstat(root)).isSymbolicLink()) return [];
    const assets: WebviewAsset[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-z][a-z0-9-]*$/.test(entry.name)) continue;
      const directory = path.join(root, entry.name);
      const manifestPath = path.join(directory, 'manifest.json');
      try {
        if ((await lstat(manifestPath)).isSymbolicLink()) continue;
        const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (!manifest || typeof manifest !== 'object' || !('id' in manifest) || manifest.id !== entry.name ||
          !('name' in manifest) || typeof manifest.name !== 'string' || !manifest.name.trim() ||
          !('entry' in manifest) || manifest.entry !== 'index.html') continue;
        const asset = { id: entry.name, name: manifest.name, directory };
        if (await readAsset([asset], `/views/${entry.name}/`)) assets.push(asset);
      } catch (error) {
        if (error instanceof SyntaxError || missingAsset(error)) continue;
        throw error;
      }
    }
    return assets.sort((left, right) => left.id.localeCompare(right.id));
  } catch (error) {
    if (missingAsset(error)) return [];
    throw error;
  }
}

function missingAsset(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && ['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(String(error.code));
}

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

export interface StaticAsset {
  bytes: Buffer;
  contentType: string;
  cacheControl: string;
}

/** Resolve only packaged, explicitly mounted files. Never fall back to workspace files or a SPA shell. */
export async function readAsset(assets: readonly WebviewAsset[], pathname: string): Promise<StaticAsset | undefined> {
  const [, prefix, id, ...segments] = pathname.split('/');
  if (prefix !== 'views') return undefined;
  const asset = assets.find(candidate => candidate.id === id);
  if (!asset) return undefined;
  if (segments.length === 0 || segments.at(-1) === '') segments.push('index.html');
  const parts = segments.filter(segment => segment !== '');
  if (parts.some(part => part.startsWith('.') || part.includes('\\') || part.includes('\0')) || parts[0] === 'manifest.json') return undefined;
  try {
    if ((await lstat(asset.directory)).isSymbolicLink()) return undefined;
    const root = await realpath(asset.directory);
    let target = root;
    for (const part of parts) {
      target = path.join(target, part);
      // Reject links even when they currently resolve inside the mount: shipped assets need no links.
      if ((await lstat(target)).isSymbolicLink()) return undefined;
    }
    const resolved = await realpath(target);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !(await lstat(resolved)).isFile()) return undefined;
    const extension = path.extname(resolved).toLowerCase();
    const contentType = mimeTypes[extension];
    if (!contentType) return undefined;
    const immutable = extension !== '.html' && /[-.][\w-]{8,}\.[a-z0-9]+$/i.test(path.basename(resolved));
    return {
      bytes: await readFile(resolved), contentType,
      cacheControl: extension === '.html' ? 'no-store' : immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
  } catch (error) {
    if (missingAsset(error)) return undefined;
    throw error;
  }
}
