import metadata from '../../../../package.json';
import { ensure } from '../../domain/shared/errors.ts';
import { nativeFormats } from '../../domain/documents/file.ts';
import type { Command, Registry } from '../../application/plugins/registry.ts';
import { arity, globalOptions } from './arguments.ts';
import { generatorCatalog } from '../generation/commands.ts';

export function catalogCommands(registry: Registry): Command[] {
  const catalog = () => ({
    name: 'The Forge', version: metadata.version, apiVersion: 1, node: metadata.engines.node,
    globalOptions, output: '{ ok, data?, error?: {code,message,details?}, context?: {workspaceRoot,root,project}, events, warnings }',
    commands: [...registry.commands.values()].map(({ id, description, usage, options }) => ({ id, description, usage, options: options ?? {} })),
    generators: generatorCatalog(registry),
    skills: [...registry.skills.keys()],
  });
  return [
    { id: 'help', description: 'Discover commands and usage without prompts.', usage: 'help [command]', run(args) {
      arity(args, 0, 1);
      if (!args[0]) return catalog();
      const command = registry.commands.get(args[0]); ensure(command, 'UNKNOWN_COMMAND', args[0]);
      const { id, description, usage, options } = command; return { id, description, usage, options: options ?? {}, globalOptions };
    } },
    { id: 'schema', description: 'Machine-readable capability catalog.', usage: 'schema', run(args) { arity(args, 0); return catalog(); } },
    { id: 'formats', description: 'Native Obsidian formats and supported operations.', usage: 'formats', run(args) {
      arity(args, 0); return { nativeFormats, structured: ['md', 'canvas', 'base'], attachments: 'Lossless byte read, copy, replace and embed; no built-in transcoding, rendering or PDF content editing.', otherFiles: 'Opaque bytes; plugins can provide additional processing.' };
    } },
  ];
}

export function extensionCommands(registry: Registry): Command[] {
  return [
    { id: 'events', description: 'List invocation event contracts.', usage: 'events', run(args, _, { events }) { arity(args, 0); return { events: events.ids(), contracts: events.catalog(), delivery: 'Ordered, awaited, per-listener snapshots; failures become warnings. Lifecycle phases cover commands, workspace operations, Claude execution and plugins. File events follow commits. onAny observes all events; replay reads bounded invocation history. No persistent replay.' }; } },
    { id: 'plugins', description: 'List explicitly loaded plugin manifests.', usage: 'plugins', run(args) { arity(args, 0); return { plugins: registry.plugins.map(p => p.manifest) }; } },
  ];
}
