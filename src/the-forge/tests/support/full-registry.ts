import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/infrastructure/workspace/config.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { commands } from '../../src/presentation/cli/commands.ts';
import { Registry } from '../../src/application/plugins/registry.ts';
import type { WorkflowServices } from '../../src/presentation/cli/services.ts';
import { registerCorePlugins, registrySkills, type CorePlugin } from '../../src/application/plugins/core-plugins.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';
import { basesPlugin } from '../../src/plugins/bases/plugin.ts';
import { skillsPlugin } from '../../src/plugins/skills/plugin.ts';
import { searchPlugin } from '../../src/plugins/search/plugin.ts';
import { linksPlugin } from '../../src/plugins/links/plugin.ts';
import { vaultCheckPlugin } from '../../src/plugins/vault-check/plugin.ts';
import { agentsPlugin } from '../../src/plugins/agents/plugin.ts';
import { backlogPlugin } from '../../src/plugins/backlog/plugin.ts';
import { webviewsPlugin } from '../../src/plugins/webviews/plugin.ts';
import { browserPlugin } from '../../src/plugins/browser/plugin.ts';
import { templatesPlugin } from '../../src/plugins/templates/plugin.ts';
import { scaffoldsPlugin } from '../../src/plugins/scaffolds/plugin.ts';
import { uiPlugin } from '../../src/plugins/ui/plugin.ts';
import { dataSourcesPlugin } from '../../src/plugins/data-sources/plugin.ts';
import { claudePlugin } from '../../src/plugins/claude/plugin.ts';
import { connectorPlugin } from '../../src/plugins/connector/plugin.ts';
import { azureDevOpsPlugin } from '../../src/plugins/connector-azure-devops/plugin.ts';
import { offlineHost, testHost } from './core-plugins.ts';

/** The bundled core plugins in bundle order, as `src/main.ts` registers them. */
export const corePlugins: readonly CorePlugin[] = [
  templatesPlugin, scaffoldsPlugin, uiPlugin, dataSourcesPlugin, claudePlugin,
  basesPlugin, skillsPlugin, searchPlugin, linksPlugin, vaultCheckPlugin, agentsPlugin, connectorPlugin, azureDevOpsPlugin, backlogPlugin, webviewsPlugin, browserPlugin('/unused-browser-distribution'),
];

/**
 * A registry with every kernel command and every bundled core plugin registered and configured with default
 * settings, as an invocation sees it before activation. Catalog commands work; file and project services fail.
 */
export async function fullRegistry(): Promise<Registry> {
  const root = await mkdtemp(join(tmpdir(), 'forge-full-registry-'));
  try {
    const loaded = await loadConfig({ defaultPath: join(root, 'bin/config.json'), cwd: root });
    const registry = new Registry(skillFrontmatter);
    const services: WorkflowServices = {
      loaded,
      server: { async start() { throw new Error('Catalog must not start servers'); }, async status() { throw new Error('Catalog must not inspect servers'); }, async stop() { throw new Error('Catalog must not stop servers'); } },
      get files(): never { throw new Error('The catalog registry does not access files'); },
      get projects(): never { throw new Error('The catalog registry does not access projects'); },
      get workflows(): never { throw new Error('The catalog registry does not access workflows'); },
      async setup() { throw new Error('The catalog registry does not run setup'); },
      configSections: () => registry.settings.sections(),
      async installedPlugins() { return []; },
    };
    const bus = new EventBus(new NodeEventScope());
    registerHostEvents(bus);
    for (const command of commands(registry, services)) registry.add(registry.commands, command);
    registerCorePlugins(registry, bus, corePlugins, testHost({ skills: registrySkills(registry), fileDates: () => { throw new Error('The catalog registry does not read files'); }, ...offlineHost }), []);
    await registry.configure({}, async () => [], () => undefined);
    return registry;
  } finally { await rm(root, { recursive: true, force: true }); }
}
