import { Registry, type Command } from '../../src/application/plugins/registry.ts';
import { testHost } from './core-plugins.ts';
import { commands } from '../../src/presentation/cli/commands.ts';
import { basesCommand } from '../../src/plugins/bases/presentation/commands.ts';
import { skillsCommand } from '../../src/plugins/skills/presentation/commands.ts';
import { uiPlugin } from '../../src/plugins/ui/plugin.ts';
import { dataSourcesPlugin } from '../../src/plugins/data-sources/plugin.ts';
import type { WorkflowServices } from '../../src/presentation/cli/services.ts';
import type { CorePlugin } from '../../src/application/plugins/core-plugins.ts';
import { templatesPlugin } from '../../src/plugins/templates/plugin.ts';
import { scaffoldsPlugin } from '../../src/plugins/scaffolds/plugin.ts';
import { claudePlugin } from '../../src/plugins/claude/plugin.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';
import { forgeVersion } from './workspace.ts';
import { errorCodes } from '../../src/domain/shared/error-catalog.ts';
import { basesErrors } from '../../src/plugins/bases/presentation/errors.ts';
import { skillErrors } from '../../src/plugins/skills/presentation/errors.ts';

/**
 * Every command the bundle registers without user plugins, assembled like the composition root but with services
 * that fail if used: kernel commands, built-in generators, and the commands of bundled core plugins. `codes` lists
 * the kernel catalog's codes and those the included core plugins register.
 */
export function builtinCommands(): { registry: Registry; commands: Map<string, Command>; codes: string[] } {
  const unavailable = (): never => { throw new Error('Metadata tests must not run commands'); };
  const services = new Proxy({ loaded: { config: { paths: {} } } }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : unavailable,
  }) as unknown as WorkflowServices;
  const registry = new Registry(skillFrontmatter, forgeVersion);
  const contributions = (plugin: CorePlugin) => plugin.create(testHost());
  const plugins = [templatesPlugin, scaffoldsPlugin, uiPlugin, dataSourcesPlugin, claudePlugin].map(contributions);
  for (const generator of plugins.flatMap(plugin => plugin.generators ?? [])) registry.add(registry.generators, generator);
  const all = [
    ...commands(registry, services),
    basesCommand(unavailable),
    skillsCommand({ list: () => [], get: () => undefined }),
    ...plugins.flatMap(plugin => plugin.commands ?? []),
  ];
  for (const command of all) registry.add(registry.commands, command);
  const codes = [...errorCodes, ...[...basesErrors, ...skillErrors, ...plugins.flatMap(plugin => plugin.errors ?? [])].map(entry => entry.code)];
  return { registry, commands: registry.commands, codes };
}
