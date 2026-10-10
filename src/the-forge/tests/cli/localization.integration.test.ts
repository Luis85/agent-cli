import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/infrastructure/workspace/config.ts';
import { describe, expect, it } from 'vitest';
import { germanActions, germanCommands, germanEvents, germanGenerators } from '../../src/presentation/localization/catalog.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { commands } from '../../src/presentation/cli/commands.ts';
import { libraryGenerators } from '../../src/presentation/generation/library-generators.ts';
import { Registry } from '../../src/application/plugins/registry.ts';
import type { WorkflowServices } from '../../src/presentation/cli/services.ts';
import { registerCorePlugins, registrySkills } from '../../src/application/plugins/core-plugins.ts';
import { basesPlugin } from '../../src/plugins/bases/plugin.ts';
import { skillsPlugin } from '../../src/plugins/skills/plugin.ts';
import { searchPlugin } from '../../src/plugins/search/plugin.ts';
import { linksPlugin } from '../../src/plugins/links/plugin.ts';
import { agentsPlugin } from '../../src/plugins/agents/plugin.ts';
import { backlogPlugin } from '../../src/plugins/backlog/plugin.ts';
import { templatesPlugin } from '../../src/plugins/templates/plugin.ts';
import { scaffoldsPlugin } from '../../src/plugins/scaffolds/plugin.ts';
import { claudePlugin } from '../../src/plugins/claude/plugin.ts';
import { bundledCorePlugins, testHost } from '../support/core-plugins.ts';

// Error-code coverage, including German summaries, lives in error-catalog tests.
describe('built-in localization catalog coverage', () => {
  it('covers every registered built-in command and generator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forge-locale-catalog-'));
    try {
      const loaded = await loadConfig({ defaultPath: join(root, 'bin/config.json'), cwd: root });
      const services: WorkflowServices = {
        loaded,
        get files(): never { throw new Error('Catalog must not access files'); },
        get projects(): never { throw new Error('Catalog must not access projects'); },
        get uiLibrary(): never { throw new Error('Catalog must not access UI library'); },
        get dataSources(): never { throw new Error('Catalog must not access data sources'); },
        get interactions(): never { throw new Error('Catalog must not access interactions'); },
        get workflows(): never { throw new Error('Catalog must not access workflows'); },
        async setup() { throw new Error('Catalog must not run setup'); },
        configSections: () => [],
        async installedPlugins() { throw new Error('Catalog must not list plugin directories'); },
      };
      const registry = new Registry();
      const kernel = commands(registry, services);
      const ids = kernel.map(command => command.id).sort();
      expect(Object.keys(germanCommands).sort()).toEqual(ids);
      // Every kernel action has a German description; make's actions are the generators below.
      const actions = kernel.filter(command => command.id !== 'make').flatMap(command => Object.keys(command.actions ?? {}).map(action => `${command.id} ${action}`));
      expect(Object.keys(germanActions).sort()).toEqual(actions.sort());
      const bus = new EventBus(new NodeEventScope());
      registerHostEvents(bus);
      expect(Object.keys(germanEvents).sort()).toEqual(bus.ids());
      expect(Object.keys(germanGenerators).sort()).toEqual(libraryGenerators(services).map(generator => generator.id).sort());
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('covers every command and error code of the bundled core plugins in German', () => {
    const registry = new Registry(), bus = new EventBus(new NodeEventScope());
    registerHostEvents(bus);
    const plugins = [basesPlugin, skillsPlugin, searchPlugin, linksPlugin, agentsPlugin, backlogPlugin, templatesPlugin, scaffoldsPlugin, claudePlugin];
    expect(plugins.map(plugin => plugin.manifest.id)).toEqual([...bundledCorePlugins]);
    registerCorePlugins(registry, bus, plugins, testHost({ skills: registrySkills(registry), fileDates: () => { throw new Error('Catalog must not read files'); } }), []);
    for (const id of registry.commands.keys()) expect(registry.catalog.text('de', 'commands', id), id).toEqual(expect.any(String));
    for (const id of registry.generators.keys()) expect(registry.catalog.text('de', 'generators', id), id).toEqual(expect.any(String));
    const german = new Localizer('de', registry.catalog);
    for (const command of registry.commands.values()) {
      for (const [action, { description }] of Object.entries(german.command(command).actions ?? {})) {
        expect(description, `${command.id} ${action}`).not.toBe(command.actions![action]!.description);
      }
    }
    for (const { code } of registry.catalog.errors()) expect(registry.catalog.localizedError(code, 'de'), code).toEqual({ summary: expect.any(String), hint: expect.any(String) });
    const pluginEvents = bus.catalog().filter(event => bundledCorePlugins.some(plugin => event.id.startsWith(`${plugin}.`)));
    expect(pluginEvents.length).toBeGreaterThan(0);
    for (const { id } of pluginEvents) expect(registry.catalog.text('de', 'events', id), id).toEqual(expect.any(String));
  });
});
