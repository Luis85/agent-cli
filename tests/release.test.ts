import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function checkout() {
  const root = await mkdtemp(join(tmpdir(), 'forge-release-'));
  temporary.push(root);
  await mkdir(join(root, 'scripts'));
  await cp(resolve('scripts/release.mjs'), join(root, 'scripts/release.mjs'));
  await cp(resolve('package.json'), join(root, 'package.json'));
  await cp(resolve('bin/app'), join(root, 'bin/app'), { recursive: true });
  await cp(resolve('bin/config.json'), join(root, 'bin/config.json'));
  return root;
}

function release(root: string) {
  return execFileSync(process.execPath, ['scripts/release.mjs'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
}

describe('release distribution', () => {
  it('extracts a complete, checksummed standalone app and reproduces the archive across checkout metadata changes', async () => {
    const root = await checkout();
    const archive = release(root);
    const first = await readFile(join(root, archive));
    const checksum = await readFile(join(root, `${archive}.sha256`), 'utf8');
    expect(checksum).toBe(`${createHash('sha256').update(first).digest('hex')}  ${archive.slice('release/'.length)}\n`);

    await utimes(join(root, 'bin/app/app.cjs'), 1_000_000, 2_000_000);
    await utimes(join(root, 'bin/app/README.md'), 3_000_000, 4_000_000);
    await chmod(join(root, 'bin/app/README.md'), 0o664);
    expect(release(root)).toBe(archive);
    expect(await readFile(join(root, archive))).toEqual(first);

    const project = join(root, 'project');
    await mkdir(project);
    await writeFile(join(project, 'package.json'), '{"type":"module"}');
    execFileSync('tar', ['-xzf', join(root, archive), '-C', project]);
    const invoke = (args: string[]) => JSON.parse(execFileSync(process.execPath, ['bin/app', ...args], { cwd: project, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } }));
    const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(invoke(['--version']).data.version).toBe(source.version);
    expect(invoke(['setup']).ok).toBe(true);
    expect(invoke(['make', 'entity', 'ReleaseTask', '--out', 'src/domain']).ok).toBe(true);
    expect(await readFile(join(project, 'src/domain/release-task.ts'), 'utf8')).toContain('class ReleaseTask');
    for (const path of ['docs/cli.md', 'skills/forge-workflow.md', 'types/sdk.d.ts', 'licenses/node_modules__yaml-LICENSE', 'examples/plugins/quality/main.mjs']) {
      expect((await readFile(join(project, 'bin/app', path))).length).toBeGreaterThan(0);
    }
    const entries = execFileSync('tar', ['-tzf', join(root, archive)], { encoding: 'utf8' }).trim().split('\n');
    expect(entries.every(path => path.startsWith('bin/app/') || path === 'bin/config.json')).toBe(true);
    expect(entries).toContain('bin/config.json');
    expect(entries.some(path => path.includes('node_modules/'))).toBe(false);
  }, 15_000);

  it('refuses an archive whose package version disagrees with the bundled executable', async () => {
    const root = await checkout();
    const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ ...source, version: '99.0.0' }));
    expect(() => release(root)).toThrow('Bundle version differs');
    const bundlePath = join(root, 'bin/app/package.json');
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
    await writeFile(bundlePath, JSON.stringify({ ...bundle, version: '99.0.0' }));
    expect(() => release(root)).toThrow('Executable version differs');
  });
});
