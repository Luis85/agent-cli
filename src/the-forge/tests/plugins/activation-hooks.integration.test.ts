import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { WorkspacePluginState, pluginStatePath } from '../../src/application/plugins/plugin-state.ts';
import { Registry, type CommandContext, type Plugin } from '../../src/application/plugins/registry.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-activation-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const calls: string[] = [];
const manifest = (id: string) => ({ id, name: id, version: '1.0.0', minAppVersion: '0.1.0', description: 'Hook test', author: 'Test' });
const hooked = (id: string, extra: Partial<Plugin> = {}): Plugin => ({
  manifest: manifest(id),
  onload() { calls.push(`${id}:onload`); },
  onUserEnable(context) { calls.push(`${id}:onUserEnable`); context.events.warn(`${id} enabled`); },
  onExternalSettingsChange() { calls.push(`${id}:onExternalSettingsChange`); },
  ...extra,
});
/** One CLI-like invocation: register, activate with persisted state, dispose. */
async function invoke(plugins: Plugin[], options: { dryRun?: boolean; settings?: Record<string, string | null> } = {}) {
  calls.length = 0;
  const files = await NodeFiles.at(root), events = new EventBus(new NodeEventScope()), registry = new Registry();
  registerHostEvents(events);
  const workspace = new Workspace(files, new ObsidianDocuments(), events, options.dryRun ?? false, root);
  const state = new WorkspacePluginState(workspace, message => events.warn(message), async id => options.settings?.[id] ?? null);
  for (const plugin of plugins) registry.register({ ...plugin }, events);
  let failure: unknown;
  try { await registry.activate(events, { workspace, events } as unknown as CommandContext, state); }
  catch (error) { failure = error; }
  finally { await registry.dispose(events); }
  return { events, failure, calls: [...calls] };
}
const stored = async () => JSON.parse(await readFile(join(root, pluginStatePath), 'utf8'));

describe('plugin activation hooks', () => {
  it('calls onUserEnable once after onload on the first activation, records it and reports the write as vault records', async () => {
    const first = await invoke([hooked('alpha'), { manifest: manifest('plain') }]);
    expect(first.calls).toEqual(['alpha:onload', 'alpha:onUserEnable']);
    expect(first.events.warnings).toEqual(['alpha enabled']);
    expect(first.events.history.map(record => record.id)).toEqual([
      'plugin.registered', 'plugin.registered', 'plugin.activating', 'plugin.activated', 'plugin.activating', 'plugin.activated',
      'operation.started', 'vault.create', 'vault.create', 'vault.create', 'operation.succeeded',
      'plugin.unloading', 'plugin.unloaded', 'plugin.unloading', 'plugin.unloaded',
    ]);
    expect(await stored()).toEqual({ schemaVersion: 1, plugins: { alpha: { settings: null } } });
    const second = await invoke([hooked('alpha'), { manifest: manifest('plain') }]);
    expect(second.calls).toEqual(['alpha:onload']);
    expect(second.events.history.some(record => record.id.startsWith('vault.'))).toBe(false);
  });

  it('calls onUserEnable again after the plugin was disabled and enabled again', async () => {
    await invoke([hooked('alpha'), hooked('beta')]);
    await invoke([hooked('beta')]);
    expect(await stored()).toEqual({ schemaVersion: 1, plugins: { beta: { settings: null } } });
    expect((await invoke([hooked('alpha'), hooked('beta')])).calls).toEqual(['alpha:onload', 'alpha:onUserEnable', 'beta:onload']);
  });

  it('runs hooks in a dry run without persisting state, so the real run still enables', async () => {
    const preview = await invoke([hooked('alpha')], { dryRun: true });
    expect(preview.calls).toEqual(['alpha:onload', 'alpha:onUserEnable']);
    await expect(readFile(join(root, pluginStatePath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(preview.events.history.some(record => record.id.startsWith('vault.') || record.id.startsWith('operation.'))).toBe(false);
    expect((await invoke([hooked('alpha')])).calls).toEqual(['alpha:onload', 'alpha:onUserEnable']);
  });

  it('calls onExternalSettingsChange when the settings revision differs from the last activation', async () => {
    await invoke([hooked('alpha')], { settings: { alpha: 'one' } });
    expect((await invoke([hooked('alpha')], { settings: { alpha: 'one' } })).calls).toEqual(['alpha:onload']);
    expect((await invoke([hooked('alpha')], { settings: { alpha: 'two' } })).calls).toEqual(['alpha:onload', 'alpha:onExternalSettingsChange']);
    expect(await stored()).toEqual({ schemaVersion: 1, plugins: { alpha: { settings: 'two' } } });
    expect((await invoke([hooked('alpha')], { settings: { alpha: 'two' } })).calls).toEqual(['alpha:onload']);
  });

  it('records completed plugins when a later activation fails and retries the failed hook next time', async () => {
    const failing = hooked('beta', { onUserEnable() { calls.push('beta:onUserEnable'); throw new Error('setup failed'); } });
    const result = await invoke([hooked('alpha'), failing]);
    expect(result.failure).toMatchObject({ message: 'setup failed' });
    expect(result.events.history.map(record => record.id)).toContain('plugin.activation-failed');
    expect(await stored()).toEqual({ schemaVersion: 1, plugins: { alpha: { settings: null } } });
    expect((await invoke([hooked('alpha'), hooked('beta')])).calls).toEqual(['alpha:onload', 'beta:onload', 'beta:onUserEnable']);
  });

  it('treats an invalid state file as empty with a warning and repairs it under its revision guard', async () => {
    await mkdir(join(root, 'bin/data'), { recursive: true });
    await writeFile(join(root, pluginStatePath), '{ not json');
    const result = await invoke([hooked('alpha')]);
    expect(result.calls).toEqual(['alpha:onload', 'alpha:onUserEnable']);
    expect(result.events.warnings).toContain(`Ignored invalid ${pluginStatePath}; plugins with activation hooks are treated as newly enabled.`);
    expect(await stored()).toEqual({ schemaVersion: 1, plugins: { alpha: { settings: null } } });
  });

  it('warns instead of failing when a concurrent writer changed the state file', async () => {
    const concurrent = '{"schemaVersion":1,"plugins":{}}\n';
    const racing = hooked('alpha', { async onUserEnable() {
      calls.push('alpha:onUserEnable');
      await mkdir(join(root, 'bin/data'), { recursive: true });
      await writeFile(join(root, pluginStatePath), concurrent);
    } });
    const result = await invoke([racing]);
    expect(result.failure).toBeUndefined();
    expect(result.calls).toEqual(['alpha:onload', 'alpha:onUserEnable']);
    expect(result.events.warnings).toEqual([expect.stringMatching(new RegExp(`^Could not record plugin activation state in ${pluginStatePath}: `))]);
    expect(await readFile(join(root, pluginStatePath), 'utf8')).toBe(concurrent);
  });

  it('rejects non-function hooks at registration and hooks that return values at activation', async () => {
    expect(() => new Registry().register({ manifest: manifest('alpha'), onUserEnable: 'yes' } as unknown as Plugin, new EventBus(new NodeEventScope()))).toThrowError(expect.objectContaining({ code: 'INVALID_PLUGIN' }));
    const result = await invoke([hooked('alpha', { onUserEnable: (() => () => {}) as unknown as Plugin['onUserEnable'] })]);
    expect(result.failure).toMatchObject({ code: 'INVALID_PLUGIN', message: 'onUserEnable must return nothing.' });
  });
});
