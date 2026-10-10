import { Registry, type Command } from '../../src/application/plugins/registry.ts';
import { generators } from '../../src/infrastructure/generation/generators.ts';
import { commands } from '../../src/presentation/cli/commands.ts';
import { libraryGenerators } from '../../src/presentation/generation/library-generators.ts';
import { claudeCommand } from '../../src/presentation/claude/commands.ts';
import { basesCommand } from '../../src/presentation/bases/commands.ts';
import { skillsCommand } from '../../src/plugins/skills/presentation/commands.ts';
import type { WorkflowServices } from '../../src/presentation/cli/services.ts';

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
  for (const generator of [...generators, ...libraryGenerators(services)]) registry.add(registry.generators, generator);
  const all = [
    ...commands(registry, services),
    claudeCommand({ agentCodec: { parse: unavailable, render: unavailable }, target: unavailable }),
    basesCommand(unavailable),
    skillsCommand({ list: () => [], get: () => undefined }),
  ];
  for (const command of all) registry.add(registry.commands, command);
  return { registry, commands: registry.commands };
}
