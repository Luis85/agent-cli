import { ensure } from '../../../domain/shared/errors.ts';
import type { Command, PluginContext } from '../../../application/plugins/registry.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { libraryMetadata, libraryOptions, localizedLibraryResult } from '../../../application/plugins/library-commands.ts';
import { interactionEvents, type InteractionEvent } from '../domain/interactions/definition.ts';
import { defaultInteractionIds } from '../application/interactions/defaults.ts';
import type { UiServicesFactory } from './components.ts';

/** Reusable behavior definitions share workspace scope with the component library. */
export function interactionsCommand(services: UiServicesFactory): Command<PluginContext> {
  return {
    id: 'interactions', description: 'Manage reusable Markdown interaction definitions for executable UI behavior.',
    usage: 'interactions [list | init | inspect <id> | validate | create <id> [--event event] | import [--from directory] | export [--out directory]] [--library directory]',
    ...libraryMetadata('interactions', 'interaction', { event: option.string('Browser event for create.', { enum: interactionEvents }) }),
    options: libraryOptions,
    errors: ['INVALID_INTERACTION', 'DUPLICATE_INTERACTION', 'UNKNOWN_INTERACTION', 'EMPTY_INTERACTION_LIBRARY', 'CONFLICT'],
    async run(args, flags, context) {
      const { settings, interactions: library } = services(context);
      const action = args[0] ?? 'list', directory = value(flags, 'library') ?? settings.interactions;
      if (action === 'list') {
        arity(args, 0, 1);
        const definitions = await library.list(directory);
        return localizedLibraryResult('interactions', context, { directory, count: definitions.length, defaults: defaultInteractionIds, status: definitions.length ? 'ready' : 'empty',
          ...(!definitions.length ? { nextStep: `Run interactions init --library ${directory}, or add a Markdown interaction definition.` } : {}),
          interactions: definitions.map(definition => ({ id: definition.id, event: definition.event, sourcePath: definition.sourcePath,
            actions: definition.actions.map(action => action.type),
            descriptionSummary: definition.description.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim() ?? '',
          })),
        });
      }
      if (action === 'init') { arity(args, 1); return { directory, ...await library.init(directory) }; }
      if (action === 'inspect') { arity(args, 2); return library.inspect(directory, args[1]!); }
      if (action === 'validate') { arity(args, 1); return localizedLibraryResult('interactions', context, await library.validate(directory)); }
      if (action === 'create') {
        arity(args, 2);
        const event = value(flags, 'event');
        return library.create(directory, args[1]!, event as InteractionEvent | undefined);
      }
      if (action === 'import') { arity(args, 1); return library.import(value(flags, 'from') ?? settings.interactionImports, directory); }
      ensure(action === 'export', 'INVALID_ARGUMENT', 'Use interactions list, init, inspect, validate, create, import, or export.');
      arity(args, 1); return library.export(directory, value(flags, 'out') ?? settings.interactionExports);
    },
  };
}
