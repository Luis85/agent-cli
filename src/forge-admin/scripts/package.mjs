import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const checking = process.argv.includes('--check');
const { config } = JSON.parse(await readFile('package.json', 'utf8'));
const destination = resolve(config.distribution);
const source = resolve('dist');
const bin = resolve(destination, '../..');
if (destination !== join(bin, 'webviews/admin')) throw new Error('config.distribution must name a bin/webviews/admin directory.');

async function directory(path, optional = false) {
  const entry = await lstat(path).catch(error => {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  });
  if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw new Error(`Expected a regular directory: ${path}`);
  return entry;
}

// Validate each distribution boundary before reading through it or creating
// directories. Check mode observes the same containment rules as publication.
for (const parent of [bin, join(bin, 'data')]) await directory(parent);
await directory(dirname(destination), !checking);
const current = await directory(destination, !checking);
const manifestPath = join(bin, 'data/distribution.json');
const manifestEntry = await lstat(manifestPath);
if (!manifestEntry.isFile() || manifestEntry.isSymbolicLink()) throw new Error('The Forge distribution manifest is not a regular file.');

async function files(root, directory = '') {
  const absolute = join(root, directory);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected a regular directory: ${absolute}`);
  const result = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await files(root, path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Expected a regular distribution file: ${path}`);
  }
  return result.sort();
}

const assets = await files(source);
for (const required of ['index.html', 'manifest.json', 'THIRD-PARTY-NOTICES.md']) {
  if (!assets.includes(required)) throw new Error(`Missing dist/${required}. Run npm run build first.`);
}
const view = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
if (!view || view.id !== 'admin' || view.entry !== 'index.html' || typeof view.name !== 'string' || !view.name.trim()) throw new Error('The admin webview manifest is invalid.');
const manifestBytes = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(manifestBytes);
if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) ||
  !manifest.files.every(path => typeof path === 'string' && path.length > 0) ||
  new Set(manifest.files).size !== manifest.files.length) throw new Error('The Forge distribution manifest is invalid.');
const maintained = assets.map(path => `webviews/admin/${path}`);
const nextManifest = JSON.stringify({ ...manifest, files: [...new Set([...manifest.files.filter(path => !path.startsWith('webviews/admin/')), ...maintained])].sort() }, null, 2) + '\n';

if (checking) {
  const published = await files(destination);
  if (JSON.stringify(published) !== JSON.stringify(assets)) throw new Error('Packaged admin assets differ. Run npm run package.');
  for (const path of assets) {
    if (!(await readFile(join(source, path))).equals(await readFile(join(destination, path)))) throw new Error(`Packaged admin asset differs: ${path}. Run npm run package.`);
  }
  if (nextManifest !== manifestBytes) throw new Error('The distribution manifest differs. Run npm run package.');
} else {
  // All outputs belong to this independent project. Never replace another view,
  // workspace configuration, selected project or plugins during publication.
  await mkdir(dirname(destination), { recursive: true });
  const staging = await mkdtemp(join(dirname(destination), '.admin-build-'));
  let replaced = false;
  let cleanStaging = true;
  try {
    await cp(source, join(staging, 'next'), { recursive: true });
    await writeFile(join(staging, 'distribution.json'), nextManifest);
    if (current) await rename(destination, join(staging, 'previous'));
    try {
      await rename(join(staging, 'next'), destination);
      replaced = true;
      await rename(join(staging, 'distribution.json'), manifestPath);
    } catch (error) {
      try {
        if (replaced) await rm(destination, { recursive: true, force: true });
        if (current) await rename(join(staging, 'previous'), destination);
      } catch (rollbackError) {
        // Windows file locks can also prevent restoration. Keep the previous
        // bundle available for recovery instead of deleting it in cleanup.
        cleanStaging = false;
        throw new AggregateError([error, rollbackError], `Publication and rollback failed. Recovery files are preserved in ${staging}.`);
      }
      throw error;
    }
  } finally { if (cleanStaging) await rm(staging, { recursive: true, force: true }); }
}
console.log(checking ? 'Packaged admin webview is current.' : 'Packaged admin webview and refreshed the distribution manifest.');
