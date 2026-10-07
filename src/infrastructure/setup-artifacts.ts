import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ensure } from '../domain/errors.ts';
import type { SetupArtifact } from '../application/setup.ts';

/** Snapshot the distribution before setup writes; symlink entries are never copied. */
export async function readSetupArtifacts(bundleDir: string): Promise<SetupArtifact[]> {
  const root = await lstat(bundleDir);
  ensure(root.isDirectory() && !root.isSymbolicLink(), 'INVALID_SETUP', 'The app bundle must be a regular directory.');
  const artifacts: SetupArtifact[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix + entry.name, path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path, relative + '/');
      else if (entry.isFile()) artifacts.push({ path: relative, bytes: await readFile(path) });
    }
  };
  await walk(bundleDir, '');
  return artifacts;
}
