import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensure } from '../domain/errors.ts';
import { vaultPath } from '../domain/file.ts';
import type { SetupArtifact } from '../application/setup.ts';
import distributionPolicy from './distribution-policy.json';

const ownedAsset = new RegExp(distributionPolicy.ownedAssetPattern);

/** Copy only declared distribution assets, never workspace state or user extensions. */
export async function readSetupArtifacts(bundleDir: string): Promise<SetupArtifact[]> {
  const root = await lstat(bundleDir);
  ensure(root.isDirectory() && !root.isSymbolicLink(), 'INVALID_SETUP', 'The bin folder must be a regular directory.');
  const readAsset = async (path: string): Promise<Uint8Array> => {
    vaultPath(path);
    ensure(ownedAsset.test(path), 'INVALID_SETUP', `Not a distribution asset: ${path}`);
    const segments = path.split('/');
    let current = bundleDir;
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      const entry = await lstat(current);
      ensure(!entry.isSymbolicLink() && (index === segments.length - 1 ? entry.isFile() : entry.isDirectory()), 'INVALID_SETUP', `Distribution paths must contain only regular files and directories: ${path}`);
    }
    return readFile(current);
  };
  const manifest: unknown = JSON.parse(new TextDecoder().decode(await readAsset('data/distribution.json')));
  ensure(typeof manifest === 'object' && manifest !== null && 'schemaVersion' in manifest && manifest.schemaVersion === distributionPolicy.schemaVersion && 'files' in manifest && Array.isArray(manifest.files), 'INVALID_SETUP', 'The distribution manifest is invalid. Rebuild or download the complete bin folder.');
  const files: unknown[] = manifest.files;
  ensure(files.every((path): path is string => typeof path === 'string') && new Set(files).size === files.length, 'INVALID_SETUP', 'The distribution manifest must contain unique paths.');
  ensure(distributionPolicy.requiredAssets.every(path => files.includes(path)), 'INVALID_SETUP', 'The distribution manifest is incomplete.');
  const artifacts: SetupArtifact[] = [];
  for (const path of files as string[]) artifacts.push({ path, bytes: await readAsset(path) });
  return artifacts;
}
