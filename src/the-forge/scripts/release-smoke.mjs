import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const execute = promisify(execFile);
const assets = resolve(process.argv[2] ?? 'release');
const version = process.argv[3] ?? JSON.parse(await readFile('package.json', 'utf8')).version;
const workspace = await mkdtemp(join(tmpdir(), 'forge-release-smoke-'));
async function cli(...args) {
  const { stdout } = await execute(process.execPath, [join(workspace, 'bin/forge.js'), '--root', workspace, '--json', ...args], { timeout: 30_000 });
  const body = JSON.parse(stdout);
  if (!body.ok) throw new Error(`Release command failed: ${args.join(' ')}`);
  return body;
}
try {
  await execute(process.execPath, [join(assets, 'install-forge.mjs'), '--version', version, '--workspace', workspace, '--assets', assets], { timeout: 60_000 });
  if ((await cli('--version')).data.version !== version) throw new Error('Installed version differs.');
  await cli('project', 'create', 'release-demo', '--dry-run');
  await cli('project', 'create', 'release-demo');
  await cli('project', 'open', 'release-demo');
  const current = await cli('project', 'current');
  if (current.data.project.name !== 'release-demo') throw new Error('Fresh project selection failed.');
  await cli('make', 'entity', 'ReleaseTask', '--out', 'src/domain');
  const entity = await readFile(join(workspace, 'projects/release-demo/src/domain/release-task.ts'), 'utf8');
  if (!entity.includes('class ReleaseTask')) throw new Error('Fresh project generation failed.');
  await cli('schema', 'apply');
  await cli('skills', 'list');
  await cli('project', 'close');
  const started = await cli('server', 'start', '--webview', 'admin');
  const url = new URL(started.data.url);
  const response = await fetch(new URL(url.pathname, url.origin));
  if (!response.ok || !(await response.text()).includes('<html')) throw new Error('Packaged admin view failed.');
  await cli('server', 'stop');
  console.log(JSON.stringify({ ok: true, version, node: process.version, platform: process.platform, installation: true, project: true, generation: true, admin: true }));
} finally {
  await cli('server', 'stop').catch(() => {});
  await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
