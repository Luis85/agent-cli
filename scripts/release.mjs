import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, mkdtemp, copyFile, rm, lstat, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import distributionPolicy from '../configs/distribution-policy.json' with { type: 'json' };

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const bundle = JSON.parse(await readFile('bin/package.json', 'utf8'));
if (bundle.version !== version) throw new Error('Bundle version differs from package.json. Run npm run build before releasing.');
const executable = JSON.parse(execFileSync(process.execPath, ['bin/app.js', '--version'], { encoding: 'utf8' }));
if (executable.data?.version !== version) throw new Error('Executable version differs from package.json. Run npm run build before releasing.');
const manifest = JSON.parse(await readFile('bin/data/distribution.json', 'utf8'));
if (manifest === null || typeof manifest !== 'object' || manifest.schemaVersion !== distributionPolicy.schemaVersion || !Array.isArray(manifest.files) || new Set(manifest.files).size !== manifest.files.length || !distributionPolicy.requiredAssets.every(path => manifest.files.includes(path))) throw new Error('Missing or invalid distribution manifest. Run npm run build.');
const ownedAsset = new RegExp(distributionPolicy.ownedAssetPattern);

/**
 * Compress with Node's zlib instead of tar's external gzip: macOS gzip stamps piped input with
 * the current time. zlib writes a zero MTIME and no file name; the OS byte is fixed to Unix (3)
 * so the archive bytes do not depend on the packaging platform.
 * @param {Uint8Array} bytes
 */
function reproducibleGzip(bytes) {
  const compressed = gzipSync(bytes, { level: 9 });
  compressed[9] = 3;
  return compressed;
}
await mkdir('release', { recursive: true });
const archive = `release/forge-${version}.tar.gz`;
const staging = await mkdtemp(join(tmpdir(), 'forge-distribution-'));
try {
  for (const path of manifest.files) {
    // Match runtime setup's contained paths, including private/reserved segments.
    // oxlint-disable-next-line no-control-regex -- Distribution paths reject ASCII control characters.
    if (typeof path !== 'string' || !ownedAsset.test(path) || /[\u0000-\u001f\\:]/.test(path) || path.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment === '.git' || segment === '.agent-cli.lock' || segment.startsWith('.agent-cli-tmp-'))) throw new Error(`Invalid distribution asset: ${path}`);
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
  await copyFile(join(staging, 'bin/config/default.json'), join(staging, 'bin/config.json'));
  await chmod(join(staging, 'bin/app.js'), 0o755);
  for (const directory of ['plugins', 'templates']) {
    await mkdir(join(staging, 'bin', directory));
    await writeFile(join(staging, 'bin', directory, '.gitkeep'), '');
  }
  // Normalize checkout metadata while retaining executable entry points. The archive is
  // streamed to stdout and the staging directory is the working directory, so GNU tar never
  // receives a drive-letter path (Windows `C:\...`), which it would parse as a remote host.
  const tarball = execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--mode=u=rwX,go=rX', '-cf', '-', 'bin'], { cwd: staging, maxBuffer: 256 * 1024 * 1024 });
  await writeFile(archive, reproducibleGzip(tarball));
} finally { await rm(staging, { recursive: true, force: true }); }
const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${hash}  forge-${version}.tar.gz\n`);
console.log(archive);
