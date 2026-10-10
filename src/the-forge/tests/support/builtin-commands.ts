import { Registry, type Command } from '../../src/application/plugins/registry.ts';
import { testHost } from './core-plugins.ts';
import { commands } from '../../src/presentation/cli/commands.ts';
import { libraryGenerators } from '../../src/presentation/generation/library-generators.ts';
import { basesCommand } from '../../src/plugins/bases/presentation/commands.ts';
import { skillsCommand } from '../../src/plugins/skills/presentation/commands.ts';
import type { WorkflowServices } from '../../src/presentation/cli/services.ts';
import type { CorePlugin } from '../../src/application/plugins/core-plugins.ts';
import { templatesPlugin } from '../../src/plugins/templates/plugin.ts';
import { scaffoldsPlugin } from '../../src/plugins/scaffolds/plugin.ts';
import { claudePlugin } from '../../src/plugins/claude/plugin.ts';

/**
 * Every command the bundle registers without user plugins, assembled like the composition root but with services
 * that fail if used: kernel commands, built-in generators, and the commands of bundled core plugins.
 */
export function builtinCommands(): { registry: Registry; commands: Map<string, Command> } {
  const unavailable = (): never => { throw new Error('Metadata tests must not run commands'); };
  const services = new Proxy({ loaded: { config: { paths: {}, ui: {} } } }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : unavailable,
  }) as unknown as WorkflowServices;
  const registry = new Registry();
  const contributions = (plugin: CorePlugin) => plugin.create(testHost());
  const [templates, scaffolds, claude] = [contributions(templatesPlugin), contributions(scaffoldsPlugin), contributions(claudePlugin)];
  for (const generator of [...libraryGenerators(services), ...templates.generators!, ...scaffolds.generators!]) registry.add(registry.generators, generator);
  const all = [
    ...commands(registry, services),
    basesCommand(unavailable),
    skillsCommand({ list: () => [], get: () => undefined }),
    ...templates.commands!,
    ...claude.commands!,
  ];
  for (const command of all) registry.add(registry.commands, command);
  return { registry, commands: registry.commands };
}
