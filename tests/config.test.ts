import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/infrastructure/config.ts';
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-config-')); await mkdir(join(root, 'bin')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const configPath = () => join(root, 'bin/config.json');
const load = (extra: { explicitPath?: string; root?: string } = {}) => loadConfig({ defaultPath: configPath(), cwd: root, ...extra });
describe('Forge configuration', () => {
  it('resolves default project root from the config file, and other paths within that root', async () => {
    await writeFile(configPath(), JSON.stringify({ paths: { projects: 'src/', templates: 'vault/templates' }, settings: { json: true } }));
    const result = await load();
    expect(result.path).toBe(configPath()); expect(result.config.paths.root).toBe(root);
    expect(result.config.paths.projects).toBe('src'); expect(result.config.paths.templates).toBe('vault/templates');
    expect(result.config.settings).toEqual({ json: true, dryRun: false });
    expect(result.config.plugins.enabled).toEqual([]);
  });
  it('allows an explicit root override and resolves explicit config relative to cwd', async () => {
    await writeFile(configPath(), JSON.stringify({ paths: { root: '../another' } }));
    expect((await load({ explicitPath: 'bin/config.json', root: '.' })).config.paths.root).toBe(root);
  });
  it('uses current workspace defaults only when an implicit config is missing', async () => {
    expect((await load()).config.paths.root).toBe(root);
    expect((await load()).path).toBeNull();
    await expect(load({ explicitPath: 'missing.json' })).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it.each([
    { schemaVersion: 2 }, { settings: { typo: true } }, { paths: { projects: '../escape' } },
    { paths: { templates: '/absolute' } }, { plugins: { enabled: ['quality', 'quality'] } },
    { plugins: { enabled: ['../bad'] } }, { settings: { json: 'true' } }, { unknown: true },
  ])('rejects invalid configuration %j', async input => {
    await writeFile(configPath(), JSON.stringify(input));
    await expect(load()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
  it('reports malformed JSON as configuration failure', async () => {
    await writeFile(configPath(), '{oops'); await expect(load()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});
