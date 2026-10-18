import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/infrastructure/workspace/config.ts';
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
    expect(result.config.settings).toEqual({ json: true, dryRun: false, language: 'en', events: 'changes' });
    expect(result.config.plugins.enabled).toEqual([]);
    expect(result.config).not.toHaveProperty('ui');
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
    await mkdir(join(root, 'fresh-environment'));
    const result = await load({ root: 'fresh-environment' });
    expect(result.root).toBe(join(root, 'fresh-environment'));
    expect(result.path).toBeNull();
    expect(result.config.paths).toEqual({ projects: 'projects' });
    expect(result.config.settings.dryRun).toBe(false);
  });
  it('rejects a selected root that does not exist or is not a directory with INVALID_ROOT', async () => {
    await writeFile(join(root, 'note.md'), 'text');
    for (const selected of ['missing-environment', 'note.md']) {
      await expect(load({ root: selected })).rejects.toMatchObject({ code: 'INVALID_ROOT', exitCode: 3, details: { root: join(root, selected) } });
    }
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
  // UI and data-source settings moved to plugins.settings.ui and plugins.settings.data-sources without aliases; the kernel rejects their former keys.
  it.each(['components', 'ui', 'stories', 'componentImports', 'componentExports', 'interactions', 'interactionImports', 'interactionExports', 'dataSources', 'dataGenerated', 'dataFixtures', 'dataImports', 'dataExports'])('rejects the moved paths.%s setting', async key => {
    await writeFile(configPath(), JSON.stringify({ paths: { [key]: 'custom' } }));
    await expect(load()).rejects.toMatchObject({ code: 'INVALID_CONFIG', message: expect.stringContaining(key) });
  });
  it('rejects the moved ui section', async () => {
    await writeFile(configPath(), JSON.stringify({ ui: { framework: 'react' } }));
    await expect(load()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  // A device-named plugin folder is no vault path: enabling one used to fail every command, --no-plugins too, with INVALID_PATH.
  it.each(['con', 'nul', 'com1', 'lpt9'])('rejects the Windows device name %s as an enabled plugin id', async id => {
    await writeFile(configPath(), JSON.stringify({ plugins: { enabled: ['quality', id] } }));
    await expect(load()).rejects.toMatchObject({ code: 'INVALID_CONFIG', message: 'plugins.enabled.1: A Windows reserved device name cannot be a plugin id.' });
  });
  it('reports malformed JSON as configuration failure', async () => {
    await writeFile(configPath(), '{oops'); await expect(load()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});
