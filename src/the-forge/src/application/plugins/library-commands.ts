import { isRecord } from '../../domain/shared/errors.ts';
import { option, type CommandAction, type CommandArgument, type CommandMetadata, type CommandOption } from './command-metadata.ts';
import type { PluginContext } from './registry.ts';

/** The writing actions only add files: existing definitions are skipped (init) or refused as duplicates. */
const createOnly = { destructive: false, idempotent: true } as const;

/**
 * Shared metadata of Markdown definition library commands (the `ui` plugin's `components` and `interactions`, the
 * `data-sources` plugin's `data-sources`): the same actions at workspace scope, where list/inspect/validate read and
 * init/create/import/export write. `--from` belongs to import, `--out` to export and `create` options to create.
 */
export function libraryMetadata(id: string, noun: string, create: Readonly<Record<string, CommandOption>> = {}): Pick<CommandMetadata, 'scope' | 'discovery' | 'mutating' | 'defaultAction' | 'unknownAction' | 'actions' | 'args'> {
  const flags = Object.entries(create).map(([name, schema]) => ` [--${name} ${schema.enum?.join('|') ?? 'value'}]`).join('');
  const actions: Record<string, CommandAction> = {
    list: { description: `List the ${noun} definitions in the library.`, usage: `${id} [list]`, mutating: false },
    init: { description: `Create the library with starter ${noun} definitions.`, usage: `${id} init`, ...createOnly },
    inspect: { description: `Return one parsed ${noun} definition.`, usage: `${id} inspect <id>`, mutating: false },
    validate: { description: `Validate every ${noun} definition.`, usage: `${id} validate`, mutating: false },
    create: { description: `Create a new ${noun} definition.`, usage: `${id} create <id>${flags}`, ...createOnly, options: create },
    import: {
      description: `Copy ${noun} definitions from the import directory into the library.`, usage: `${id} import [--from directory]`, ...createOnly,
      options: { from: option.string('Import source directory for import.') },
    },
    export: {
      description: `Copy the library's ${noun} definitions to the export directory.`, usage: `${id} export [--out directory]`, ...createOnly,
      options: { out: option.string('Export destination directory for export.') },
    },
  };
  const args: CommandArgument[] = [
    { name: 'action', description: 'list (default), init, inspect, validate, create, import or export.', enum: Object.keys(actions) },
    { name: 'id', description: 'The definition id for inspect and create.' },
  ];
  return { scope: 'workspace', discovery: false, mutating: true, defaultAction: 'list', unknownAction: 'INVALID_ARGUMENT', actions, args };
}

/** The library directory option every library action accepts. */
export const libraryOptions = {
  library: option.string('Library directory, relative to the workspace; defaults to the configured path.'),
};

/**
 * A library result in the invocation language: an empty library's `nextStep` becomes the plugin's `emptyLibrary`
 * message with `{command}` and `{directory}` filled in. English results keep the guidance their use case wrote.
 */
export function localizedLibraryResult<T>(command: string, context: PluginContext, result: T): T {
  if (context.language === 'en' || !isRecord(result) || result.status !== 'empty' || typeof result.directory !== 'string' || typeof result.nextStep !== 'string') return result;
  const message = context.t('emptyLibrary');
  if (message === 'emptyLibrary') return result;
  return { ...result, nextStep: message.replace('{command}', command).replace('{directory}', result.directory) };
}
