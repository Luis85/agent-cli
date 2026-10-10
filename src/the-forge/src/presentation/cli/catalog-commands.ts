import metadata from '../../../package.json';
import { ensure } from '../../domain/shared/errors.ts';
import { errorCatalog, errorCodes } from '../../domain/shared/error-catalog.ts';
import { nativeFormats, textExtensions } from '../../domain/documents/file.ts';
import { eventOutputLevels } from '../../application/plugins/event-output.ts';
import { hostEventNamespaces } from '../../application/plugins/host-events.ts';
import type { Command, Registry } from '../../application/plugins/registry.ts';
import { arity, globalOptions } from './arguments.ts';
import { generatorCatalog } from '../generation/commands.ts';

export function catalogCommands(registry: Registry): Command[] {
  const catalog = () => ({
    name: 'The Forge', version: metadata.version, apiVersion: 1, node: metadata.engines.node,
    globalOptions, output: '{ ok, data?, error?: {code,message,hint?,retryable?,details?}, context?: {workspaceRoot,root,project}, events, warnings }',
    eventOutput: { option: '--events', setting: 'settings.events', levels: eventOutputLevels, default: 'changes', changes: 'Only committed vault.* records: vault.create, vault.modify, vault.delete and vault.rename, for files and folders.' },
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
    { id: 'schema', description: 'Machine-readable capability catalog.', usage: 'schema', run(args) {
      arity(args, 0);
      // Built-in failure codes; hints arrive with each failure as error.hint.
      return { ...catalog(), errors: errorCodes.map(code => { const { exitCode, category, retryable, summary } = errorCatalog[code]; return { code, exitCode, category, retryable, summary }; }) };
    } },
    { id: 'formats', description: 'Native Obsidian formats and supported operations.', usage: 'formats', run(args) {
      arity(args, 0); return { nativeFormats, structured: ['md', 'canvas', 'base'], text: textExtensions, textFiles: 'UTF-8 read, literal edit, append and full replacement with unified dry-run diffs; files that are not valid UTF-8 read as base64 attachments.', attachments: 'Lossless byte read, copy, replace and embed; no built-in transcoding, rendering or PDF content editing.', otherFiles: 'Opaque bytes; plugins can provide additional processing.' };
    } },
  ];
}

const hostNamespaces = [...hostEventNamespaces];
const eventDelivery = 'Ordered, awaited, per-listener snapshots; failures become warnings. Obsidian-style vault.* records follow each committed write (new folders first, parent before child, then files in batch order); dry runs emit workspace.quick-preview instead. metadataCache.* contracts are reserved for the kernel index. operation.*, command.*, claude.* and plugin.* records are lifecycle phases; workspace.* records are Obsidian workspace analogues (file-open, quick-preview, layout-ready, quit, project-change). Host namespaces are host-owned: plugins observe them but emit only their own events. onAny observes all events; replay reads bounded invocation history. No persistent replay. Responses include only vault.* records by default; --events none|changes|all or settings.events selects the output without changing delivery or replay.';

export function extensionCommands(registry: Registry): Command[] {
  return [
    { id: 'events', description: 'List invocation event contracts.', usage: 'events', run(args, _, { events }) {
      arity(args, 0);
      return { events: events.ids(), contracts: events.catalog(), hostNamespaces, delivery: eventDelivery };
    } },
    { id: 'plugins', description: 'List explicitly loaded plugin manifests.', usage: 'plugins', run(args) { arity(args, 0); return { plugins: registry.plugins.map(p => p.manifest) }; } },
  ];
}
