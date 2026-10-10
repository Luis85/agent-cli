import metadata from '../../../package.json';
import { errorCatalog, errorCodes } from '../../domain/shared/error-catalog.ts';
import { nativeFormats, textExtensions } from '../../domain/documents/file.ts';
import { eventOutputLevels } from '../../application/plugins/event-output.ts';
import { hostEventNamespaces } from '../../application/plugins/host-events.ts';
import { commandAnnotations, commandInputSchema } from '../../application/plugins/command-metadata.ts';
import { arity } from '../../application/plugins/command-input.ts';
import type { Command, Registry } from '../../application/plugins/registry.ts';
import { globalOptionMetadata } from './arguments.ts';
import type { WorkflowServices } from './services.ts';
import { generatorCatalog } from '../generation/commands.ts';
import { pluginCatalog } from './plugin-catalog.ts';

const discovery = { scope: 'workspace', discovery: true, mutating: false } as const;
const commandArgument = [{ name: 'command', description: 'A command id from the catalog.' }];

/** One command as help and schema describe it, generated from its metadata. */
function describe(command: Command) {
  const { id, description, usage, options, args, output, errors } = command;
  return {
    id, description, usage, options: options ?? {}, args: args ?? [], annotations: commandAnnotations(command),
    errors: errors ?? [], ...(output ? { outputSchema: output } : {}),
  };
}

export function catalogCommands(registry: Registry): Command[] {
  const catalog = () => ({
    name: 'The Forge', version: metadata.version, apiVersion: 1, node: metadata.engines.node,
    globalOptions: globalOptionMetadata, output: '{ ok, data?, error?: {code,message,hint?,retryable?,details?}, context?: {workspaceRoot,root,project}, events, warnings }',
    eventOutput: { option: '--events', setting: 'settings.events', levels: eventOutputLevels, default: 'changes', changes: 'Only committed vault.* records: vault.create, vault.modify, vault.delete and vault.rename, for files and folders.' },
    commands: [...registry.commands.values()].map(describe),
    generators: generatorCatalog(registry),
    skills: [...registry.skills.keys()],
  });
  return [
    { id: 'help', description: 'Discover commands and usage without prompts.', usage: 'help [command]', ...discovery, args: commandArgument, errors: ['UNKNOWN_COMMAND', 'PLUGIN_UNAVAILABLE'], run(args) {
      arity(args, 0, 1);
      if (!args[0]) return catalog();
      const command = registry.resolveCommand(args[0]);
      return { ...describe(command), globalOptions: globalOptionMetadata };
    } },
    { id: 'schema', description: 'Machine-readable capability catalog.', usage: 'schema', ...discovery, run(args) {
      arity(args, 0);
      // Built-in failure codes, then plugin-registered codes; hints arrive with each failure as error.hint.
      const builtIn = errorCodes.map(code => { const { exitCode, category, retryable, summary } = errorCatalog[code]; return { code, exitCode, category, retryable, summary }; });
      const contributed = registry.catalog.errors().map(({ code, exitCode, category, retryable, summary, pluginId }) => ({ code, exitCode, category, retryable, summary, plugin: pluginId }));
      const { commands, ...rest } = catalog();
      return { ...rest, commands: [...registry.commands.values()].map((command, index) => ({ ...commands[index]!, inputSchema: commandInputSchema(command) })), errors: [...builtIn, ...contributed] };
    } },
    { id: 'formats', description: 'Native Obsidian formats and supported operations.', usage: 'formats', ...discovery, run(args) {
      arity(args, 0); return { nativeFormats, structured: ['md', 'canvas', 'base'], text: textExtensions, textFiles: 'UTF-8 read, literal edit, append and full replacement with unified dry-run diffs; files that are not valid UTF-8 read as base64 attachments.', attachments: 'Lossless byte read, copy, replace and embed; no built-in transcoding, rendering or PDF content editing.', otherFiles: 'Opaque bytes; plugins can provide additional processing.' };
    } },
  ];
}

const hostNamespaces = [...hostEventNamespaces];
const eventDelivery = 'Ordered, awaited, per-listener snapshots; failures become warnings. Obsidian-style vault.* records follow each committed write (new folders first, parent before child, then files in batch order); dry runs emit workspace.quick-preview instead. Once the metadata cache is loaded in the invocation, the vault.* records of each batch are followed by metadataCache.changed, metadataCache.deleted, metadataCache.resolve and one metadataCache.resolved. operation.*, command.*, claude.* and plugin.* records are lifecycle phases; workspace.* records are Obsidian workspace analogues (file-open, quick-preview, layout-ready, quit, project-change). Host namespaces are host-owned: plugins observe them but emit only their own events. onAny observes all events; replay reads bounded invocation history. No persistent replay. Responses include only vault.* records by default; --events none|changes|all or settings.events selects the output without changing delivery or replay.';

export function extensionCommands(registry: Registry, services: Pick<WorkflowServices, 'installedPlugins'>): Command[] {
  return [
    { id: 'events', description: 'List invocation event contracts.', usage: 'events', ...discovery, run(args, _, { events }) {
      arity(args, 0);
      return { events: events.ids(), contracts: events.catalog(), hostNamespaces, delivery: eventDelivery };
    } },
    { id: 'plugins', description: 'List core and user plugins with their state and contributions.', usage: 'plugins', ...discovery, async run(args) {
      arity(args, 0);
      return { plugins: pluginCatalog(registry, await services.installedPlugins()) };
    } },
  ];
}
