import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, mkdtemp, copyFile, rm, lstat, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const bundle = JSON.parse(await readFile('bin/package.json', 'utf8'));
if (bundle.version !== version) throw new Error('Bundle version differs from package.json. Run npm run build before releasing.');
const executable = JSON.parse(execFileSync(process.execPath, ['bin/app.js', '--version'], { encoding: 'utf8' }));
if (executable.data?.version !== version) throw new Error('Executable version differs from package.json. Run npm run build before releasing.');
const manifest = JSON.parse(await readFile('bin/data/distribution.json', 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !['app.js', 'package.json', 'data/distribution.json'].every(path => manifest.files.includes(path))) throw new Error('Missing or invalid distribution manifest. Run npm run build.');
const ownedAsset = /^(?:app\.js|package\.json|config\/default\.json|skills\/.+|data\/(?:LICENSE|README\.md|THIRD-PARTY-NOTICES\.md|distribution\.json|(?:docs|examples|types|licenses)\/.+))$/;
await mkdir('release', { recursive: true });
const archive = `release/forge-${version}.tar.gz`;
const staging = await mkdtemp(join(tmpdir(), 'forge-distribution-'));
try {
  for (const path of manifest.files) {
    if (typeof path !== 'string' || !ownedAsset.test(path) || path.includes('\\') || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error(`Invalid distribution asset: ${path}`);
    let current = 'bin';
    const segments = path.split('/');
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      const entry = await lstat(current);
      if (entry.isSymbolicLink() || !(index === segments.length - 1 ? entry.isFile() : entry.isDirectory())) throw new Error(`Distribution asset is not a regular file: ${path}`);
    }
    const destination = join(staging, 'bin', path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(current, destination);
  }
  // Never publish local configuration, project context, plugins or templates.
  await copyFile('bin/config/default.json', join(staging, 'bin/config.json'));
  await chmod(join(staging, 'bin/app.js'), 0o755);
  for (const directory of ['plugins', 'templates']) {
    await mkdir(join(staging, 'bin', directory));
    await writeFile(join(staging, 'bin', directory, '.gitkeep'), '');
  }
  // Normalize checkout metadata while retaining executable entry points.
  execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--mode=u=rwX,go=rX', '-czf', resolve(archive), '-C', staging, 'bin']);
} finally { await rm(staging, { recursive: true, force: true }); }
const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${hash}  forge-${version}.tar.gz\n`);
console.log(archive);
