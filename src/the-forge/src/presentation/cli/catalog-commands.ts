import metadata from '../../../package.json';
import { forgeIdentity } from './identity.ts';
import { errorCatalog, errorCodes } from '../../domain/shared/error-catalog.ts';
import { nativeFormats, textExtensions, textFilenames } from '../../domain/documents/file.ts';
import { eventOutputLevels } from '../../application/plugins/event-output.ts';
import { hostEventNamespaces } from '../../application/plugins/host-events.ts';
import { commandAnnotations, commandInputSchema, option, outputDocument } from '../../application/plugins/command-metadata.ts';
import { jsonSchemaDialect } from '../../domain/schema/json-schema.ts';
import { arity } from '../../application/plugins/command-input.ts';
import { ensure } from '../../domain/shared/errors.ts';
import type { Command, Registry } from '../../application/plugins/registry.ts';
import { globalOptionMetadata } from './arguments.ts';
import { declaredErrors } from './invocation-policy.ts';
import type { KernelServices } from './services.ts';
import { generatorCatalog } from '../generation/commands.ts';
import { pluginCatalog } from './plugin-catalog.ts';
import { Localizer } from '../localization/localization.ts';
import { envelopeSchema } from './envelope.ts';
import { helpIndex } from './help-index.ts';
import { schemaOutput } from './catalog-output.ts';

const discovery = { scope: 'workspace', discovery: true, mutating: false } as const;
const commandArgument = [{ name: 'command', description: 'A command id from the catalog.' }];
/** Where the entry index of `help` points next. */
const helpNext = 'Run help <command> for its usage, options, arguments, errors and examples, or schema <command> for its JSON Schemas. make lists generators; skills lists agent skills.';
/**
 * Input, routing and runtime codes any command can report besides its declared `errors`; a project-scoped command
 * reads the saved project selection, which fails with INVALID_PROJECT_CONTEXT or STALE_PROJECT_CONTEXT.
 */
export const commonErrors = [
  'UNKNOWN_COMMAND', 'UNKNOWN_OPTION', 'MISSING_ARGUMENT', 'INVALID_ARGUMENT', 'INVALID_OPTION_VALUE', 'DUPLICATE_OPTION', 'INVALID_LANGUAGE', 'INVALID_ROOT', 'INVALID_CONFIG',
  'INVALID_PATH', 'UNSAFE_PATH', 'INVALID_PROJECT_CONTEXT', 'STALE_PROJECT_CONTEXT', 'WORKSPACE_BUSY', 'INVALID_RESULT', 'OPERATION_FAILED',
];

/** One command as help and schema describe it, generated from its metadata. */
function describe(command: Command, includeOutput = true) {
  const { id, description, usage, options, args, output, examples } = command;
  const annotations = commandAnnotations(command);
  if (!includeOutput && annotations.actions) {
    annotations.actions = Object.fromEntries(Object.entries(annotations.actions).map(([id, action]) => {
      const { outputSchema: _output, ...description } = action;
      return [id, description];
    }));
  }
  return {
    id, description, usage, ...(examples ? { examples: [...examples] } : {}), options: options ?? {}, args: args ?? [], annotations,
    errors: declaredErrors(command), ...(includeOutput && output ? { outputSchema: outputDocument(id, output) } : {}),
  };
}

export function catalogCommands(registry: Registry): Command[] {
  const identity = { ...forgeIdentity, node: metadata.engines.node };
  const catalog = () => ({
    ...identity, dialect: jsonSchemaDialect,
    globalOptions: globalOptionMetadata, envelope: envelopeSchema,
    eventOutput: { option: '--events', setting: 'settings.events', levels: eventOutputLevels, default: 'changes', changes: 'Only committed vault.* records: vault.create, vault.modify, vault.delete and vault.rename, for files and folders.' },
    commands: [...registry.commands.values()].map(command => describe(command)),
    generators: generatorCatalog(registry),
    skills: [...registry.skills.keys()],
  });
  return [
    { id: 'help', description: 'Discover commands and usage without prompts.', usage: 'help [command]', ...discovery, args: commandArgument, errors: ['UNKNOWN_COMMAND'],
      localizedOutput: { next: 'text', globalOptions: 'options' }, run(args) {
      arity(args, 0, 1);
      // The entry index helps an agent choose its next command in under 4 KB; help <command> has the details.
      if (!args[0]) return helpIndex(identity, [...registry.commands.values()], Object.keys(globalOptionMetadata).map(key => `--${key}`), helpNext);
      const command = registry.resolveCommand(args[0]);
      return { ...describe(command, false), globalOptions: globalOptionMetadata };
    } },
    { id: 'schema', description: 'Machine-readable contract: JSON Schema 2020-12 input and output schemas, annotations and error codes of one command, or with --all of every command; without either, an index of command, generator and skill ids.', usage: 'schema [command | --all]', ...discovery, args: commandArgument,
      options: { all: option.boolean('Return the complete contract of every command instead of the index.') }, errors: ['UNKNOWN_COMMAND'], output: schemaOutput,
      localizedOutput: { more: 'text', eventOutput: 'text', globalOptions: 'options', generators: 'generators', errors: 'errors' }, run(args, flags) {
      arity(args, 0, 1);
      ensure(args[0] === undefined || flags.all !== true, 'INVALID_ARGUMENT', 'Pass a command or --all, not both.');
      // The index names every command, generator and skill without schemas; schema <command> or --all returns the contracts.
      if (args[0] === undefined && flags.all !== true) return {
        ...identity, dialect: jsonSchemaDialect,
        commands: [...registry.commands.values()].map(({ id, description }) => ({ id, description })),
        generators: generatorCatalog(registry), skills: [...registry.skills.keys()],
        more: 'Run schema <command> for one command\'s contract, or schema --all for every command.',
      };
      // Built-in failure codes, then plugin-registered codes; hints arrive with each failure as error.hint.
      const builtIn = errorCodes.map(code => { const { exitCode, category, retryable, summary } = errorCatalog[code]; return { code, exitCode, category, retryable, summary }; });
      const contributed = registry.catalog.errors().map(({ code, exitCode, category, retryable, summary, pluginId }) => ({ code, exitCode, category, retryable, summary, plugin: pluginId }));
      const errors = [...builtIn, ...contributed];
      const contract = (command: Command) => ({ ...describe(command), inputSchema: commandInputSchema(command) });
      if (args[0] === undefined) return { ...catalog(), commands: [...registry.commands.values()].map(contract), commonErrors, errors };
      // One command's contract keeps the document shape with only the codes that command can report.
      const command = registry.resolveCommand(args[0]);
      const codes = new Set([...commonErrors, ...declaredErrors(command)]);
      const { generators: _generators, skills: _skills, ...head } = catalog();
      return { ...head, commands: [contract(command)], commonErrors, errors: errors.filter(entry => codes.has(entry.code)) };
    } },
    { id: 'formats', description: 'Native Obsidian formats and supported operations.', usage: 'formats', ...discovery,
      localizedOutput: { textFiles: 'text', attachments: 'text', otherFiles: 'text' }, run(args) {
      arity(args, 0); return { nativeFormats, structured: ['md', 'canvas', 'base'], text: textExtensions, textFilenames, textFiles: 'textFilenames match case-insensitively, including dot suffixes that start with a non-dot character; native extensions take precedence. UTF-8 read, literal edit, append and full replacement with unified dry-run diffs; files that are not valid UTF-8 or contain NUL characters read as base64 attachments.', attachments: 'Lossless byte read, copy, replace and embed; no built-in transcoding, rendering or PDF content editing.', otherFiles: 'Opaque bytes; plugins can provide additional processing.' };
    } },
  ];
}

const hostNamespaces = [...hostEventNamespaces];
const eventDelivery = 'Ordered, awaited, per-listener snapshots; failures become warnings. Obsidian-style vault.* records follow each committed write (new folders first, parent before child, then files in batch order); dry runs emit workspace.quick-preview instead. Once the metadata cache is loaded in the invocation, the vault.* records of each batch are followed by metadataCache.changed, metadataCache.deleted, metadataCache.resolve and one metadataCache.resolved. operation.*, command.* and plugin.* records are host lifecycle phases, and the claude core plugin\'s claude.* records are the phases of each Claude invocation; workspace.* records are Obsidian workspace analogues (file-open, quick-preview, layout-ready, quit, project-change). Host namespaces are host-owned: plugins observe them but emit only their own events. onAny observes all events; replay reads bounded invocation history. No persistent replay. Responses include only vault.* records by default; --events none|changes|all or settings.events selects the output without changing delivery or replay.';

export function extensionCommands(registry: Registry, services: Pick<KernelServices, 'installedPlugins'>): Command[] {
  return [
    { id: 'events', description: 'List invocation event contracts.', usage: 'events', ...discovery, localizedOutput: { contracts: 'events', delivery: 'text' }, run(args, _, { events }) {
      arity(args, 0);
      return { events: events.ids(), contracts: events.catalog(), hostNamespaces, delivery: eventDelivery };
    } },
    { id: 'plugins', description: 'List core and user plugins with their state and contributions.', usage: 'plugins', ...discovery, async run(args, _, { language }) {
      arity(args, 0);
      return { plugins: pluginCatalog(registry, await services.installedPlugins(), new Localizer(language, registry.catalog)) };
    } },
  ];
}
