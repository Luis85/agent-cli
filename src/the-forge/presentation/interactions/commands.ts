import { ensure } from '../../domain/shared/errors.ts';
import { interactionEvents, type InteractionEvent } from '../../domain/interactions/definition.ts';
import type { Command } from '../../application/plugins/registry.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { defaultInteractionIds } from '../../application/interactions/defaults.ts';
import { arity, value } from '../cli/arguments.ts';

/** Reusable behavior definitions share workspace scope with the component library. */
export function interactionCommands(services: WorkflowServices): Command[] {
  const config = services.loaded.config;
  return [{
    id: 'interactions', description: 'Manage reusable Markdown interaction definitions for executable UI behavior.',
    usage: 'interactions [list | init | inspect <id> | validate | create <id> [--event event] | import [--from directory] | export [--out directory]] [--library directory]',
    options: { library: 'string', from: 'string', out: 'string', event: 'string' },
    async run(args, flags) {
      const action = args[0] ?? 'list', directory = value(flags, 'library') ?? config.paths.interactions;
      ensure(flags.from === undefined || action === 'import', 'INVALID_ARGUMENT', '--from requires interactions import.');
      ensure(flags.out === undefined || action === 'export', 'INVALID_ARGUMENT', '--out requires interactions export.');
      ensure(flags.event === undefined || action === 'create', 'INVALID_ARGUMENT', '--event requires interactions create.');
      const library = services.interactions;
      if (action === 'list') {
        arity(args, 0, 1);
        const definitions = await library.list(directory);
        return { directory, count: definitions.length, defaults: defaultInteractionIds, status: definitions.length ? 'ready' : 'empty',
          ...(!definitions.length ? { nextStep: `Run interactions init --library ${directory}, or add a Markdown interaction definition.` } : {}),
          interactions: definitions.map(definition => ({ id: definition.id, event: definition.event, sourcePath: definition.sourcePath,
            actions: definition.actions.map(action => action.type),
            descriptionSummary: definition.description.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim() ?? '',
          })),
        };
      }
      if (action === 'init') { arity(args, 1); return { directory, ...await library.init(directory) }; }
      if (action === 'inspect') { arity(args, 2); return library.inspect(directory, args[1]!); }
      if (action === 'validate') { arity(args, 1); return library.validate(directory); }
      if (action === 'create') {
        arity(args, 2);
        const event = value(flags, 'event');
        ensure(event === undefined || interactionEvents.includes(event as InteractionEvent), 'INVALID_ARGUMENT', `--event must be one of: ${interactionEvents.join(', ')}.`);
        return library.create(directory, args[1]!, event as InteractionEvent | undefined);
      }
      if (action === 'import') { arity(args, 1); return library.import(value(flags, 'from') ?? config.paths.interactionImports, directory); }
      ensure(action === 'export', 'INVALID_ARGUMENT', 'Use interactions list, init, inspect, validate, create, import, or export.');
      arity(args, 1); return library.export(directory, value(flags, 'out') ?? config.paths.interactionExports);
    },
  }];
}
