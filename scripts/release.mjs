import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const bundle = JSON.parse(await readFile('bin/app/package.json', 'utf8'));
if (bundle.version !== version) throw new Error('Bundle version differs from package.json. Run npm run build before releasing.');
const executable = JSON.parse(execFileSync(process.execPath, ['bin/app', '--version'], { encoding: 'utf8' }));
if (executable.data?.version !== version) throw new Error('Executable version differs from package.json. Run npm run build before releasing.');
await mkdir('release', { recursive: true });
const archive = `release/forge-${version}.tar.gz`;
// GNU tar normalizes checkout metadata while retaining executable entry points.
execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--mode=u=rwX,go=rX', '-czf', archive, 'bin/app', 'bin/config.json']);
const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${hash}  forge-${version}.tar.gz\n`);
console.log(archive);
