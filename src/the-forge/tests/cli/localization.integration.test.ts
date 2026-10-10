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
import { claudeCommand } from '../../src/presentation/claude/commands.ts';
import { generators } from '../../src/infrastructure/generation/generators.ts';
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
import { connectorPlugin } from '../../src/plugins/connector/plugin.ts';
import { azureDevOpsPlugin } from '../../src/plugins/connector-azure-devops/plugin.ts';
import { bundledCorePlugins, offlineHost } from '../support/core-plugins.ts';

// Error-code coverage, including German summaries, lives in error-catalog tests.
describe('built-in localization catalog coverage', () => {
  it('covers every registered built-in command and generator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forge-locale-catalog-'));
    try {
      const loaded = await loadConfig({ defaultPath: join(root, 'bin/config.json'), cwd: root });
      const services: WorkflowServices = {
        loaded,
        get files(): never { throw new Error('Catalog must not access files'); },
        get templates(): never { throw new Error('Catalog must not access templates'); },
        get projects(): never { throw new Error('Catalog must not access projects'); },
        get uiLibrary(): never { throw new Error('Catalog must not access UI library'); },
        get dataSources(): never { throw new Error('Catalog must not access data sources'); },
        get interactions(): never { throw new Error('Catalog must not access interactions'); },
        get workflows(): never { throw new Error('Catalog must not access workflows'); },
        async installTemplates() { throw new Error('Catalog must not install templates'); },
        async setup() { throw new Error('Catalog must not run setup'); },
        configSections: () => [],
        async installedPlugins() { throw new Error('Catalog must not list plugin directories'); },
      };
      const registry = new Registry();
      const unavailable = (): never => { throw new Error('Catalog must not invoke management services'); };
      const management = [claudeCommand({
        agentCodec: { parse: unavailable, render: unavailable }, target: unavailable,
      })];
      const kernel = [...commands(registry, services), ...management];
      const ids = kernel.map(command => command.id).sort();
      expect(Object.keys(germanCommands).sort()).toEqual(ids);
      // Every kernel action has a German description; make's actions are the generators below.
      const actions = kernel.filter(command => command.id !== 'make').flatMap(command => Object.keys(command.actions ?? {}).map(action => `${command.id} ${action}`));
      expect(Object.keys(germanActions).sort()).toEqual(actions.sort());
      const bus = new EventBus(new NodeEventScope());
      registerHostEvents(bus);
      expect(Object.keys(germanEvents).sort()).toEqual(bus.ids());
      expect(Object.keys(germanGenerators).sort()).toEqual([...generators, ...libraryGenerators(services)].map(generator => generator.id).sort());
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('covers every command and error code of the bundled core plugins in German', () => {
    const registry = new Registry(), bus = new EventBus(new NodeEventScope());
    registerHostEvents(bus);
    const plugins = [basesPlugin, skillsPlugin, searchPlugin, linksPlugin, agentsPlugin, connectorPlugin, azureDevOpsPlugin, backlogPlugin];
    expect(plugins.map(plugin => plugin.manifest.id)).toEqual([...bundledCorePlugins]);
    registerCorePlugins(registry, bus, plugins, { skills: registrySkills(registry), fileDates: () => { throw new Error('Catalog must not read files'); }, ...offlineHost }, []);
    for (const id of registry.commands.keys()) expect(registry.catalog.text('de', 'commands', id), id).toEqual(expect.any(String));
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
