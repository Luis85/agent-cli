import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/infrastructure/config.ts';
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-config-')); await mkdir(join(root, 'bin')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const configPath = () => join(root, 'bin/config.json');
const load = (extra: { root?: string; cwd?: string } = {}) => loadConfig({ defaultPath: configPath(), cwd: root, ...extra });
describe('Forge configuration', () => {
  it('resolves the environment root from its config and normalizes the projects directory', async () => {
    await writeFile(configPath(), JSON.stringify({ paths: { projects: 'src/' }, settings: { json: true } }));
    const result = await load();
    expect(result.path).toBe(configPath()); expect(result.root).toBe(root);
    expect(result.config.paths).toEqual({ projects: 'src' });
    expect(result.config.settings).toEqual({ json: true, dryRun: false });
    expect(result.config.plugins.enabled).toEqual([]);
  });
  it('loads only fixed bin/config.json from the explicitly selected environment', async () => {
    const target = join(root, 'another');
    await mkdir(join(target, 'bin'), { recursive: true });
    await writeFile(configPath(), JSON.stringify({ paths: { projects: 'source-projects' } }));
    await writeFile(join(target, 'bin/config.json'), JSON.stringify({ paths: { projects: 'target-projects' } }));
    const selected = await load({ root: 'another' });
    expect(selected.root).toBe(target);
    expect(selected.path).toBe(join(target, 'bin/config.json'));
    expect(selected.config.paths.projects).toBe('target-projects');
  });
  it('keeps the bundle environment root independent of the working directory when config is missing', async () => {
    const result = await load({ cwd: join(root, 'unrelated-working-directory') });
    expect(result.root).toBe(root);
    expect(result.config.paths).toEqual({ projects: 'projects' });
    expect(result.path).toBeNull();
  });
  it('uses defaults for an explicitly selected environment without importing the source config', async () => {
    await writeFile(configPath(), JSON.stringify({ paths: { projects: 'source-projects' }, settings: { dryRun: true } }));
    const result = await load({ root: 'fresh-environment' });
    expect(result.root).toBe(join(root, 'fresh-environment'));
    expect(result.path).toBeNull();
    expect(result.config.paths).toEqual({ projects: 'projects' });
    expect(result.config.settings.dryRun).toBe(false);
  });
  it('does not fall back to source defaults when the selected environment config is invalid', async () => {
    const target = join(root, 'invalid-environment');
    await mkdir(join(target, 'bin'), { recursive: true });
    await writeFile(join(target, 'bin/config.json'), '{broken');
    await expect(load({ root: target })).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it.each([
    { schemaVersion: 2 }, { settings: { typo: true } }, { paths: { projects: '../escape' } },
    { paths: { projects: '/absolute' } }, { paths: { projects: 'bin' } }, { paths: { projects: 'bin/projects' } },
    { plugins: { enabled: ['quality', 'quality'] } },
    { plugins: { enabled: ['../bad'] } }, { settings: { json: 'true' } }, { unknown: true },
  ])('rejects invalid configuration %j', async input => {
    await writeFile(configPath(), JSON.stringify(input));
    await expect(load()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it.each(['root', 'config', 'bin', 'templates', 'output', 'generated', 'plugins', 'skills'])('rejects the removed configurable %s path', async key => {
    await writeFile(configPath(), JSON.stringify({ paths: { [key]: 'custom' } }));
    await expect(load()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it('reports malformed JSON as configuration failure', async () => {
    await writeFile(configPath(), '{oops'); await expect(load()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});
