import { isRecord } from '../../domain/shared/errors.ts';
import { option, type CommandAction, type CommandArgument, type CommandMetadata } from './command-metadata.ts';
import type { CommandContext, PluginContext } from './registry.ts';

/**
 * Shared metadata of Markdown definition library commands (the `ui` plugin's `components` and `interactions`, the
 * `data-sources` plugin's `data-sources`): the same actions at workspace scope, where list/inspect/validate read and
 * init/create/import/export write.
 */
export function libraryMetadata(noun: string): Pick<CommandMetadata, 'scope' | 'discovery' | 'mutating' | 'defaultAction' | 'actions' | 'args'> {
  const actions: Record<string, CommandAction> = {
    list: { description: `List the ${noun} definitions in the library.`, mutating: false },
    init: { description: `Create the library with starter ${noun} definitions.` },
    inspect: { description: `Return one parsed ${noun} definition.`, mutating: false },
    validate: { description: `Validate every ${noun} definition.`, mutating: false },
    create: { description: `Create a new ${noun} definition.` },
    import: { description: `Copy ${noun} definitions from the import directory into the library.` },
    export: { description: `Copy the library's ${noun} definitions to the export directory.` },
  };
  const args: CommandArgument[] = [
    { name: 'action', description: 'list (default), init, inspect, validate, create, import or export.', enum: Object.keys(actions) },
    { name: 'id', description: 'The definition id for inspect and create.' },
  ];
  return { scope: 'workspace', discovery: false, mutating: true, defaultAction: 'list', actions, args };
}

export const libraryOptions = {
  library: option.string('Library directory, relative to the workspace; defaults to the configured path.'),
  from: option.string('Import source directory for import.'),
  out: option.string('Export destination directory for export.'),
};

/**
 * A library result in the invocation language: an empty library's `nextStep` becomes the plugin's `emptyLibrary`
 * message with `{command}` and `{directory}` filled in. English results keep the guidance their use case wrote.
 */
export function localizedLibraryResult<T>(command: string, context: CommandContext, result: T): T {
  if (context.language === 'en' || !isRecord(result) || result.status !== 'empty' || typeof result.directory !== 'string' || typeof result.nextStep !== 'string') return result;
  const message = (context as PluginContext).t('emptyLibrary');
  if (message === 'emptyLibrary') return result;
  return { ...result, nextStep: message.replace('{command}', command).replace('{directory}', result.directory) };
}
