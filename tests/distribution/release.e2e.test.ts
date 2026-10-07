import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function checkout() {
  const root = await mkdtemp(join(tmpdir(), 'forge-release-'));
  temporary.push(root);
  await mkdir(join(root, 'scripts'), { recursive: true });
  await cp(resolve('scripts/release.mjs'), join(root, 'scripts/release.mjs'));
  await cp(resolve('configs/distribution-policy.json'), join(root, 'configs/distribution-policy.json'));
  await cp(resolve('package.json'), join(root, 'package.json'));
  await cp(resolve('bin'), join(root, 'bin'), { recursive: true });
  return root;
}

function release(root: string) {
  return execFileSync(process.execPath, ['scripts/release.mjs'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
}

describe('release distribution', () => {
  it('repackages owned assets without replacing configuration, context, plugins or templates', async () => {
    const root = await checkout();
    for (const path of ['src', 'docs', 'examples', 'scripts/licenses']) await cp(resolve(path), join(root, path), { recursive: true });
    for (const path of ['scripts/package.mjs', 'tsconfig.json', 'tsconfig.sdk.json', 'package-lock.json', 'README.md', 'LICENSE']) await cp(resolve(path), join(root, path));
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    const privateFiles = ['bin/config.json', 'bin/data/context.json', 'bin/data/private.json', 'bin/plugins/private.mjs', 'bin/templates/private.md'];
    for (const path of privateFiles) await writeFile(join(root, path), `preserve ${path}\n`);
    await writeFile(join(root, 'bin/data/docs/obsolete.md'), '# Stale generated documentation');
    execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: root, stdio: 'pipe' });
    for (const path of privateFiles) expect(await readFile(join(root, path), 'utf8')).toBe(`preserve ${path}\n`);
    await expect(readFile(join(root, 'bin/data/docs/obsolete.md'))).rejects.toThrow();
    const manifest = JSON.parse(await readFile(join(root, 'bin/data/distribution.json'), 'utf8'));
    expect(manifest.files).toContain('app.js');
    expect(manifest.files).toContain('data/types/sdk.d.ts');
    expect(manifest.files.some((path: string) => /context|private|obsolete/.test(path))).toBe(false);
  }, 15_000);

  it('extracts a complete, checksummed standalone app and reproduces the archive across checkout metadata changes', async () => {
    const root = await checkout();
    const archive = release(root);
    const first = await readFile(join(root, archive));
    const checksum = await readFile(join(root, `${archive}.sha256`), 'utf8');
    expect(checksum).toBe(`${createHash('sha256').update(first).digest('hex')}  ${archive.slice('release/'.length)}\n`);

    await utimes(join(root, 'bin/app.js'), 1_000_000, 2_000_000);
    await utimes(join(root, 'bin/data/README.md'), 3_000_000, 4_000_000);
    await chmod(join(root, 'bin/data/README.md'), 0o664);
    expect(release(root)).toBe(archive);
    expect(await readFile(join(root, archive))).toEqual(first);

    const project = join(root, 'project');
    await mkdir(project);
    await writeFile(join(project, 'package.json'), '{"type":"module"}');
    execFileSync('tar', ['-xzf', join(root, archive), '-C', project]);
    const invoke = (args: string[]) => JSON.parse(execFileSync(process.execPath, ['bin/app.js', ...args], { cwd: project, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } }));
    const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(invoke(['--version']).data.version).toBe(source.version);
    expect(invoke(['setup']).ok).toBe(true);
    expect(invoke(['make', 'entity', 'ReleaseTask', '--out', 'src/domain']).ok).toBe(true);
    expect(await readFile(join(project, 'src/domain/release-task.ts'), 'utf8')).toContain('class ReleaseTask');
    for (const path of ['docs/reference/cli.md', 'types/sdk.d.ts', 'licenses/node_modules__yaml-LICENSE', 'examples/plugins/quality/main.mjs']) {
      expect((await readFile(join(project, 'bin/data', path))).length).toBeGreaterThan(0);
    }
    const entries = execFileSync('tar', ['-tzf', join(root, archive)], { encoding: 'utf8' }).trim().split('\n');
    expect(entries.every(path => path.startsWith('bin/'))).toBe(true);
    expect(entries).toContain('bin/app.js');
    expect(entries).toContain('bin/package.json');
    expect(entries).toContain('bin/data/distribution.json');
    expect(entries).toContain('bin/plugins/.gitkeep');
    expect(entries).toContain('bin/templates/.gitkeep');
    expect(entries).toContain('bin/config.json');
    expect(entries).toContain('bin/config/default.json');
    expect(entries).toContain('bin/skills/forge-workflow.md');
    expect(entries.some(path => path.startsWith('bin/data/skills/'))).toBe(false);
    expect(entries.some(path => path.includes('node_modules/'))).toBe(false);
  }, 15_000);

  it('refuses an archive whose package version disagrees with the bundled executable', async () => {
    const root = await checkout();
    const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ ...source, version: '99.0.0' }));
    expect(() => release(root)).toThrow('Bundle version differs');
    const bundlePath = join(root, 'bin/package.json');
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
    await writeFile(bundlePath, JSON.stringify({ ...bundle, version: '99.0.0' }));
    expect(() => release(root)).toThrow('Executable version differs');
  });

  it('ships defaults and distribution assets without local settings, context or extensions', async () => {
    const root = await checkout();
    await writeFile(join(root, 'bin/config.json'), '{"private":"workspace settings"}');
    await writeFile(join(root, 'bin/data/context.json'), '{"activeProject":"private-project"}');
    await writeFile(join(root, 'bin/data/private.json'), '{"token":"local-only"}');
    await writeFile(join(root, 'bin/plugins/private-plugin.mjs'), 'export default {};');
    await writeFile(join(root, 'bin/templates/private-template.md'), '# Private');
    const archive = release(root);
    const entries = execFileSync('tar', ['-tzf', join(root, archive)], { encoding: 'utf8' }).trim().split('\n');
    expect(entries.some(path => /context|private/.test(path))).toBe(false);
    const config = execFileSync('tar', ['-xOf', join(root, archive), 'bin/config.json'], { encoding: 'utf8' });
    expect(config).toBe(await readFile(join(root, 'bin/config/default.json'), 'utf8'));
    expect(await readFile(join(root, 'bin/data/context.json'), 'utf8')).toContain('private-project');
  });

  it('rejects a manifest that attempts to publish mutable workspace data', async () => {
    const root = await checkout();
    await writeFile(join(root, 'bin/data/context.json'), '{}');
    const path = join(root, 'bin/data/distribution.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.files.push('data/context.json');
    await writeFile(path, JSON.stringify(manifest));
    expect(() => release(root)).toThrow('Invalid distribution asset: data/context.json');
  });
  it.each(['missing-defaults', 'duplicate-assets'])('rejects an invalid distribution manifest: %s', async invalid => {
    const root = await checkout();
    const path = join(root, 'bin/data/distribution.json');
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { schemaVersion: number; files: string[] };
    if (invalid === 'missing-defaults') manifest.files = manifest.files.filter(file => file !== 'config/default.json');
    else manifest.files.push('app.js');
    await writeFile(path, JSON.stringify(manifest));
    expect(() => release(root)).toThrow('Missing or invalid distribution manifest');
  });
});
