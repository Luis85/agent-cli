#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const repository = 'Luis85/agent-cli';
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!['--version', '--workspace', '--assets'].includes(key) || !value || options.has(key)) throw new Error('Usage: node install-forge.mjs --version <x.y.z> --workspace <path> [--assets <download-directory>]');
  options.set(key, value);
}
const version = options.get('--version');
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !options.get('--workspace')) throw new Error('A pinned release version and workspace path are required.');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || major === 22 && minor < 12) throw new Error('The Forge requires Node 22.12 or newer.');
const workspace = resolve(options.get('--workspace'));
const archiveName = `forge-${version}.tar.gz`;
let staging;
async function absent(path) {
  try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
async function invoke(root, args) {
  const { stdout } = await execute(process.execPath, [join(root, 'bin/forge.js'), '--root', root, '--json', ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (!result.ok) throw new Error(`Forge ${args.join(' ')} failed.`);
  return result.data;
}
try {
  if (!await absent(join(workspace, 'bin'))) throw new Error('The workspace already has bin/. Install into a new directory; existing installations require a reviewed upgrade.');
  await mkdir(workspace, { recursive: true });
  staging = await mkdtemp(join(workspace, '.forge-install-'));
  let assets = options.get('--assets') ? resolve(options.get('--assets')) : staging;
  if (!options.has('--assets')) {
    for (const filename of [archiveName, `${archiveName}.sha256`]) {
      await execute('curl', ['--fail', '--location', '--silent', '--show-error', '--proto', '=https', '--max-time', '180', '--max-filesize', '67108864',
        `https://github.com/${repository}/releases/download/v${version}/${filename}`, '--output', join(staging, filename)], { timeout: 190_000 });
    }
  }
  const archive = join(assets, archiveName);
  const checksum = (await readFile(`${archive}.sha256`, 'utf8')).trim();
  const match = /^([a-f0-9]{64})  (forge-\d+\.\d+\.\d+\.tar\.gz)$/.exec(checksum);
  if (!match || match[2] !== archiveName || createHash('sha256').update(await readFile(archive)).digest('hex') !== match[1]) throw new Error('Release checksum verification failed. Nothing was installed.');
  const { stdout: listing } = await execute('tar', ['-tzf', archive], { maxBuffer: 8 * 1024 * 1024 });
  const paths = listing.trim().split(/\r?\n/);
  if (!paths.length || paths.some(path => !path.startsWith('bin/') || path.includes('\\') || path.includes(':') || path.split('/').some(part => part === '.' || part === '..'))) throw new Error('Release archive contains an unsafe path.');
  const { stdout: detailed } = await execute('tar', ['-tvzf', archive], { maxBuffer: 8 * 1024 * 1024 });
  if (detailed.trim().split(/\r?\n/).some(line => !['-', 'd'].includes(line[0]))) throw new Error('Release archive contains a link or special file.');
  await execute('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', staging]);
  const manifest = JSON.parse(await readFile(join(staging, 'bin/package.json'), 'utf8'));
  if (manifest.version !== version || (await invoke(staging, ['--version'])).version !== version) throw new Error('Release executable version differs from the requested version.');
  if (!await absent(join(staging, 'bin/data/context.json'))) throw new Error('Release contains a saved project selection.');
  const defaults = await readFile(join(staging, 'bin/config/default.json'));
  if (!defaults.equals(await readFile(join(staging, 'bin/config.json')))) throw new Error('Release configuration differs from generic defaults.');
  // Recheck immediately before installing; never replace an existing bin directory.
  if (!await absent(join(workspace, 'bin'))) throw new Error('bin/ appeared during installation. Nothing was replaced.');
  await rename(join(staging, 'bin'), join(workspace, 'bin'));
  await invoke(workspace, ['setup', '--dry-run']);
  await invoke(workspace, ['setup']);
  console.log(JSON.stringify({ ok: true, version, workspace, checksum: match[1], next: ['node bin/forge.js project create my-project --dry-run', 'node bin/forge.js project create my-project', 'node bin/forge.js project open my-project'] }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
} finally {
  if (staging) await rm(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
