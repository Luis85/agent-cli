import { expect, it } from 'vitest';
import { EventBus } from '../../src/application/plugins/events.ts';
import { Registry, type PluginManifest } from '../../src/application/plugins/registry.ts';
import { registerCorePlugins, registrySkills, type CorePlugin } from '../../src/application/plugins/core-plugins.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { pluginCatalog } from '../../src/presentation/cli/plugin-catalog.ts';

const manifest = (id: string): PluginManifest => ({ id, name: id, version: '1.0.0', minAppVersion: '0.1.0', description: 'Catalog test', author: 'Test' });
const core = (id: string, contributions: ReturnType<CorePlugin['create']> = {}): CorePlugin => ({ manifest: { ...manifest(id), core: true }, create: () => contributions });

it('lists every plugin with one state and a reason for each state but enabled, and rejects user plugins that reuse a core id', async () => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  const plugins = [core('bases', { provides: { 'bases.query': {} } }), core('search'), core('backlog', { requires: ['bases.query'] })];
  registerCorePlugins(registry, events, plugins, { skills: registrySkills(registry), fileDates: () => () => Promise.reject(new Error('unused')) }, ['bases']);
  registry.register({ manifest: manifest('quality') }, events);
  await registry.configure({}, async () => [], () => { throw new Error('A cascade from a disabled provider must not warn'); });
  const installed = [...['bases', 'search', 'quality', 'drafts'].map(id => ({ manifest: manifest(id), skipped: false })), { manifest: manifest('later'), skipped: true }];
  const listed = pluginCatalog(registry, installed).map(({ id, core: bundled, state, reason }) => ({ id, core: bundled, state, reason }));
  expect(listed).toEqual([
    { id: 'search', core: true, state: 'enabled', reason: null },
    { id: 'backlog', core: true, state: 'unavailable', reason: 'Requires service bases.query; its provider bases is disabled.' },
    { id: 'bases', core: true, state: 'disabled', reason: 'Listed in plugins.disabled.' },
    { id: 'quality', core: false, state: 'enabled', reason: null },
    { id: 'bases', core: false, state: 'rejected', reason: 'Plugin id bases is reserved by the bundled core plugin; rename the user plugin.' },
    { id: 'search', core: false, state: 'rejected', reason: 'Plugin id search is reserved by the bundled core plugin; rename the user plugin.' },
    { id: 'drafts', core: false, state: 'disabled', reason: 'Not listed in plugins.enabled.' },
    { id: 'later', core: false, state: 'skipped', reason: 'Skipped by --no-plugins.' },
  ]);
  // An unavailable plugin's code ran, so its contributions stay listed.
  expect(pluginCatalog(registry, []).find(entry => entry.id === 'backlog')!.contributions).toMatchObject({ services: { requires: ['bases.query'] } });
});
