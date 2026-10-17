import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AppUpdate, type ReleaseAssets } from '../../src/plugins/updates/application/update.ts';
import { updateCommand } from '../../src/plugins/updates/presentation/commands.ts';
import { updateApplySchema, updateCheckSchema } from '../../src/plugins/updates/presentation/schemas.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';
import { invocationPolicy } from '../../src/presentation/cli/invocation-policy.ts';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { vaultScope, writeVault } from '../support/vault.ts';
import policy from '../../configs/distribution-policy.json';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const owned = [...policy.requiredAssets, 'data/docs/obsolete.md'];
const preserved = {
  'bin/config.json': '{"paths":{"projects":"custom-projects"}}',
  'bin/data/context.json': '{"project":"active-project"}',
  'bin/data/private.json': '{"setting":"keep"}',
  'bin/plugins/private/main.mjs': 'export default {};',
  'bin/templates/private.md': '# My template',
  'bin/webviews/custom/index.html': '<h1>Local view</h1>',
  'notes/work.md': '# User work',
};
function release(version = '0.1.1'): ReleaseAssets {
  const desired = [...policy.requiredAssets, 'data/docs/new.md'];
  const files = desired.map(path => {
    const text = path === 'package.json' ? JSON.stringify({ name: 'forge-bundle', version })
      : path === 'data/distribution.json' ? JSON.stringify({ schemaVersion: 1, files: desired })
      : path.endsWith('.json') ? '{}' : `updated ${path}`;
    const bytes = new TextEncoder().encode(text);
    return { path, bytes, revision: createHash('sha256').update(bytes).digest('hex') };
  });
  return { version, checksum: 'a'.repeat(64), files };
}
async function fixture(dryRun = false) {
  const root = await mkdtemp(join(tmpdir(), 'forge-update-test-')); roots.push(root);
  const initial = Object.fromEntries(owned.map(path => [`bin/${path}`, path.endsWith('.json') ? '{}' : `old ${path}`]));
  initial['bin/package.json'] = JSON.stringify({ name: 'forge-bundle', version: '0.1.0' });
  initial['bin/data/distribution.json'] = JSON.stringify({ schemaVersion: 1, files: owned });
  await writeVault(root, { ...initial, ...preserved });
  const scope = await vaultScope(root, { dryRun });
  const context: CommandContext = { workspace: scope.workspace, environment: scope.workspace, events: scope.events,
    metadata: scope.metadata, app: scope.app, workspaceRoot: root, root, project: null, language: 'en', input: async () => new Uint8Array() };
  const source = { latest: vi.fn(async () => '0.1.1'), download: vi.fn(async (_version: string) => release()) };
  return { root, scope, context, source, updater: new AppUpdate(source, policy) };
}

describe('guarded release upgrades', () => {
  it('checks without changing the app and exposes workspace discovery and output schemas', async () => {
    const { context, updater, source } = await fixture();
    const command = updateCommand(updater);
    const before = (await context.environment.files.stat('bin')).revision;
    const report = await command.run([], {}, context);
    expect(report).toMatchObject({ installedVersion: '0.1.0', releaseVersion: '0.1.1', available: true, revision: before });
    expect(invocationPolicy(command, [], {})).toEqual({ scope: 'workspace', activatePlugins: false });
    expect(validateJsonValue(updateCheckSchema, report, 'data').issues).toEqual([]);
    expect(source.download).not.toHaveBeenCalled();
    expect((await context.environment.files.stat('bin')).revision).toBe(before);
  });

  it('upgrades owned app assets together, removes obsolete assets, preserves every user file and supports a no-change repeat', async () => {
    const { root, context, updater } = await fixture();
    const report = await updater.check(context);
    const result = await updater.apply(context, '0.1.1', report.revision);
    expect(result).toMatchObject({ changed: true, dryRun: false, restartRequired: true });
    expect(validateJsonValue(updateApplySchema, result, 'data').issues).toEqual([]);
    expect(JSON.parse(await readFile(join(root, 'bin/package.json'), 'utf8')).version).toBe('0.1.1');
    await expect(readFile(join(root, 'bin/data/docs/obsolete.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const [path, text] of Object.entries(preserved)) expect(await readFile(join(root, path), 'utf8'), path).toBe(text);
    expect(await updater.apply(context, '0.1.1', result.revision)).toMatchObject({ changed: false, changes: [], restartRequired: false });
    await expect(updater.apply(context, '0.1.1', report.revision)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('previews the upgrade plan without downloading or running the release, changing app bytes or emitting committed vault events', async () => {
    const { context, updater, scope, source } = await fixture(true);
    const report = await updater.check(context);
    const result = await updater.apply(context, '0.1.1', report.revision);
    expect(result).toEqual({ installedVersion: '0.1.0', releaseVersion: '0.1.1', checksum: null, downloaded: false, changed: true, dryRun: true,
      changes: [], revision: report.revision, restartRequired: false });
    expect(validateJsonValue(updateApplySchema, result, 'data').issues).toEqual([]);
    expect(source.download).not.toHaveBeenCalled();
    await expect(updater.apply(context, '0.1.1', '0'.repeat(64))).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(updater.apply(context, '0.0.9', report.revision)).rejects.toMatchObject({ code: 'UPDATE_INVALID' });
    expect((await context.environment.files.stat('bin')).revision).toBe(report.revision);
    expect(scope.events.history.filter(event => event.id.startsWith('vault.'))).toEqual([]);
  });

  it('rejects concurrent edits after downloading and writes none of the planned upgrade', async () => {
    const { root, context, updater, source } = await fixture();
    const report = await updater.check(context);
    source.download.mockImplementation(async () => { await writeFile(join(root, 'bin/config.json'), '{"changed":true}'); return release(); });
    await expect(updater.apply(context, '0.1.1', report.revision)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(JSON.parse(await readFile(join(root, 'bin/package.json'), 'utf8')).version).toBe('0.1.0');
    expect(await readFile(join(root, 'bin/forge-runtime.js'), 'utf8')).toBe('old forge-runtime.js');
  });

  it('refuses downgrades, failed downloads and manifests that include mutable workspace data', async () => {
    const { root, context, updater, source } = await fixture();
    const report = await updater.check(context);
    await expect(updater.apply(context, '0.0.9', report.revision)).rejects.toMatchObject({ code: 'UPDATE_INVALID' });
    source.download.mockRejectedValueOnce(new Error('Download failed'));
    await expect(updater.apply(context, '0.1.1', report.revision)).rejects.toThrow('Download failed');
    expect((await context.environment.files.stat('bin')).revision).toBe(report.revision);
    await writeFile(join(root, 'bin/data/distribution.json'), JSON.stringify({ schemaVersion: 1, files: [...owned, 'config.json'] }));
    await expect(updater.check(context)).rejects.toMatchObject({ code: 'UPDATE_INVALID' });
  });
});
