import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { distribution, workspaceRoot } from '../support/workspace.ts';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

/** A workspace fixture with the Forge project at src/the-forge; returns the project directory. */
async function checkout() {
  const workspace = await mkdtemp(join(tmpdir(), 'forge-release-'));
  temporary.push(workspace);
  const root = join(workspace, 'src/the-forge');
  await mkdir(join(root, 'scripts'), { recursive: true });
  await cp(resolve('scripts/release.mjs'), join(root, 'scripts/release.mjs'));
  await cp(resolve('configs/distribution-policy.json'), join(root, 'configs/distribution-policy.json'));
  await cp(resolve('package.json'), join(root, 'package.json'));
  await cp(distribution, join(workspace, 'bin'), { recursive: true });
  return root;
}
/** package.json config.distribution places the bundle in the workspace bin directory. */
const bin = (root: string, path: string) => join(root, '../../bin', path);

function release(root: string) {
  return execFileSync(process.execPath, ['scripts/release.mjs'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
}

// Run tar from the checkout with relative paths: GNU tar reads `C:\...` archive names as remote hosts.
function tar(root: string, args: string[]) {
  return execFileSync('tar', args, { cwd: root, encoding: 'utf8' });
}
const entries = (root: string, archive: string) => tar(root, ['-tzf', archive]).trim().split(/\r?\n/);

describe('release distribution', () => {
  it('repackages owned assets without replacing configuration, context, plugins or templates', async () => {
    const root = await checkout();
    for (const path of ['src', 'docs', 'skills', 'scripts/licenses']) await cp(resolve(path), join(root, path), { recursive: true });
    for (const path of ['scripts/package.mjs', 'tsconfig.json', 'tsconfig.sdk.json', 'package-lock.json', 'README.md']) await cp(resolve(path), join(root, path));
    await cp(join(workspaceRoot, 'LICENSE'), join(root, '../../LICENSE'));
    // A junction needs no symlink privilege on Windows; other platforms ignore the type.
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'junction');
    const privateFiles = ['config.json', 'data/context.json', 'data/private.json', 'plugins/private.mjs', 'templates/private.md'];
    for (const path of privateFiles) await writeFile(bin(root, path), `preserve ${path}\n`);
    await writeFile(bin(root, 'data/docs/obsolete.md'), '# Stale generated documentation');
    await writeFile(bin(root, 'skills/obsolete.md'), '# Stale packaged skill');
    await mkdir(join(root, 'docs/research'), { recursive: true });
    await writeFile(join(root, 'docs/research/notes.md'), '# Maintainer research');
    execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: root, stdio: 'pipe' });
    for (const path of privateFiles) expect(await readFile(bin(root, path), 'utf8')).toBe(`preserve ${path}\n`);
    await expect(readFile(bin(root, 'data/docs/obsolete.md'))).rejects.toThrow();
    await expect(readFile(bin(root, 'skills/obsolete.md'))).rejects.toThrow();
    await expect(readFile(bin(root, 'data/docs/research/notes.md'))).rejects.toThrow();
    expect(await readFile(bin(root, 'skills/forge-workflow/SKILL.md'), 'utf8')).toBe(await readFile(resolve('skills/forge-workflow/SKILL.md'), 'utf8'));
    const manifest = JSON.parse(await readFile(bin(root, 'data/distribution.json'), 'utf8'));
    expect(manifest.files).toContain('forge.js');
    expect(manifest.files).toContain('data/types/sdk.d.ts');
    expect(manifest.files.some((path: string) => /context|private|obsolete/.test(path))).toBe(false);
  }, 60_000);

  it('extracts a complete, checksummed standalone app and reproduces the archive across checkout metadata changes', async () => {
    const root = await checkout();
    const archive = release(root);
    const first = await readFile(join(root, archive));
    // The gzip header carries no packaging time, file name or platform: flags 0, MTIME 0, OS Unix.
    expect([...first.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 3]);
    const checksum = await readFile(join(root, `${archive}.sha256`), 'utf8');
    expect(checksum).toBe(`${createHash('sha256').update(first).digest('hex')}  ${archive.slice('release/'.length)}\n`);

    await utimes(bin(root, 'forge.js'), 1_000_000, 2_000_000);
    await utimes(bin(root, 'data/README.md'), 3_000_000, 4_000_000);
    await chmod(bin(root, 'data/README.md'), 0o664);
    expect(release(root)).toBe(archive);
    expect(await readFile(join(root, archive))).toEqual(first);

    const project = join(root, 'project');
    await mkdir(project);
    await writeFile(join(project, 'package.json'), '{"type":"module"}');
    tar(root, ['-xzf', archive, '-C', 'project']);
    const invoke = (args: string[]) => JSON.parse(execFileSync(process.execPath, ['bin/forge.js', ...args], { cwd: project, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } }));
    const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(invoke(['--version']).data.version).toBe(source.version);
    expect(invoke(['setup']).ok).toBe(true);
    expect(invoke(['make', 'entity', 'ReleaseTask', '--out', 'src/domain']).ok).toBe(true);
    expect(await readFile(join(project, 'src/domain/release-task.ts'), 'utf8')).toContain('class ReleaseTask');
    for (const path of ['docs/reference/cli.md', 'types/sdk.d.ts', 'licenses/node_modules__yaml-LICENSE', 'licenses/node_modules__ajv-LICENSE', 'licenses/docker-agent-LICENSE', 'docs/examples/plugins/quality/main.mjs']) {
      expect((await readFile(join(project, 'bin/data', path))).length).toBeGreaterThan(0);
    }
    // The agents plugin embeds docker-agent's Apache-2.0 schema; its notice names the vendored commit.
    expect(await readFile(join(project, 'bin/data/THIRD-PARTY-NOTICES.md'), 'utf8')).toMatch(/## docker-agent agent-schema\.json\n\nCopied unchanged from https:\/\/github\.com\/docker\/docker-agent at commit [a-f0-9]{40}\. License: Apache-2\.0\./);
    // Plugins type dry-run write previews with the shipped SDK.
    const sdk = await readFile(join(project, 'bin/data/types/sdk.d.ts'), 'utf8');
    // Trusted plugins type the claude.lifecycle service without importing the claude plugin.
    for (const name of ['PlannedChange', 'WriteOptions', 'WriteRequest', 'FileChange', 'ClaudeLifecycleClient', 'ClaudeLifecycleRequest', 'ClaudeLifecycleResult', 'ClaudeLifecyclePlan', 'ClaudeOutput']) expect(sdk).toMatch(new RegExp(`\\b${name}\\b`));
    const listed = entries(root, archive);
    expect(listed.every(path => path.startsWith('bin/'))).toBe(true);
    expect(listed).toContain('bin/forge.js');
    expect(listed).toContain('bin/package.json');
    expect(listed).toContain('bin/data/distribution.json');
    expect(listed).toContain('bin/plugins/.gitkeep');
    expect(listed).toContain('bin/templates/.gitkeep');
    expect(listed).toContain('bin/config.json');
    expect(listed).toContain('bin/config/default.json');
    expect(listed).toContain('bin/skills/forge-workflow/SKILL.md');
    expect(listed.some(path => path.startsWith('bin/data/skills/'))).toBe(false);
    expect(listed.some(path => path.includes('node_modules/'))).toBe(false);
  }, 60_000);

  it('refuses an archive whose package version disagrees with the bundled executable', async () => {
    const root = await checkout();
    const source = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ ...source, version: '99.0.0' }));
    expect(() => release(root)).toThrow('Bundle version differs');
    const bundlePath = bin(root, 'package.json');
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
    await writeFile(bundlePath, JSON.stringify({ ...bundle, version: '99.0.0' }));
    expect(() => release(root)).toThrow('Executable version differs');
  });

  it('ships defaults and distribution assets without local settings, context or extensions', async () => {
    const root = await checkout();
    await writeFile(bin(root, 'config.json'), '{"private":"workspace settings"}');
    await writeFile(bin(root, 'data/context.json'), '{"activeProject":"private-project"}');
    await writeFile(bin(root, 'data/private.json'), '{"token":"local-only"}');
    await writeFile(bin(root, 'plugins/private-plugin.mjs'), 'export default {};');
    await writeFile(bin(root, 'templates/private-template.md'), '# Private');
    const archive = release(root);
    expect(entries(root, archive).some(path => /context|private/.test(path))).toBe(false);
    const config = tar(root, ['-xOzf', archive, 'bin/config.json']);
    expect(config).toBe(await readFile(bin(root, 'config/default.json'), 'utf8'));
    expect(await readFile(bin(root, 'data/context.json'), 'utf8')).toContain('private-project');
  });

  it('rejects a manifest that attempts to publish mutable workspace data', async () => {
    const root = await checkout();
    await writeFile(bin(root, 'data/context.json'), '{}');
    const path = bin(root, 'data/distribution.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.files.push('data/context.json');
    await writeFile(path, JSON.stringify(manifest));
    expect(() => release(root)).toThrow('Invalid distribution asset: data/context.json');
  });
  it.each(['missing-defaults', 'duplicate-assets'])('rejects an invalid distribution manifest: %s', async invalid => {
    const root = await checkout();
    const path = bin(root, 'data/distribution.json');
    const manifest = JSON.parse(await readFile(path, 'utf8')) as { schemaVersion: number; files: string[] };
    if (invalid === 'missing-defaults') manifest.files = manifest.files.filter(file => file !== 'config/default.json');
    else manifest.files.push('forge.js');
    await writeFile(path, JSON.stringify(manifest));
    expect(() => release(root)).toThrow('Missing or invalid distribution manifest');
  });
});
