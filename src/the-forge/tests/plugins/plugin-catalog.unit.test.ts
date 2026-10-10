import { expect, it } from 'vitest';
import { EventBus } from '../../src/application/plugins/events.ts';
import { Registry, type PluginManifest } from '../../src/application/plugins/registry.ts';
import { registerCorePlugins, registrySkills, type CorePlugin } from '../../src/application/plugins/core-plugins.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { pluginCatalog } from '../../src/presentation/cli/plugin-catalog.ts';

const manifest = (id: string): PluginManifest => ({ id, name: id, version: '1.0.0', minAppVersion: '0.1.0', description: 'Catalog test', author: 'Test' });
const core = (id: string): CorePlugin => ({ manifest: { ...manifest(id), core: true }, create: () => ({}) });

it('lists one core entry per bundled id and a separate rejected entry for a user plugin that reuses it', () => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  registerCorePlugins(registry, events, [core('bases'), core('search')], { skills: registrySkills(registry), fileDates: () => () => Promise.reject(new Error('unused')) }, ['bases']);
  registry.register({ manifest: manifest('quality') }, events);
  const installed = ['bases', 'search', 'quality', 'drafts'].map(id => ({ manifest: manifest(id), skipped: false }));
  const listed = pluginCatalog(registry, installed).map(({ id, core: bundled, state, ...rest }) => ({ id, core: bundled, state, ...('reason' in rest ? { reason: rest.reason } : {}) }));
  expect(listed).toEqual([
    { id: 'search', core: true, state: 'enabled' },
    { id: 'bases', core: true, state: 'disabled' },
    { id: 'quality', core: false, state: 'enabled' },
    { id: 'bases', core: false, state: 'rejected', reason: 'Plugin id bases is reserved by the bundled core plugin; rename the user plugin.' },
    { id: 'search', core: false, state: 'rejected', reason: 'Plugin id search is reserved by the bundled core plugin; rename the user plugin.' },
    { id: 'drafts', core: false, state: 'disabled' },
  ]);
});
