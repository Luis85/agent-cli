import { ensure } from '../../../domain/shared/errors.ts';
import type { Command, CommandContext } from '../../../application/plugins/registry.ts';
import { arity, value } from '../../../application/plugins/command-input.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { libraryMetadata, libraryOptions, localizedLibraryResult } from '../../../application/plugins/library-commands.ts';
import { componentDependencies } from '../domain/components/library.ts';
import type { UiLibrary } from '../application/components/library.ts';
import type { InteractionLibrary } from '../application/interactions/library.ts';
import type { UiSettings } from '../application/settings.ts';

/** What the ui plugin's commands and generators work with in one invocation, wired by `plugin.ts`. */
export interface UiServices { settings: UiSettings; components: UiLibrary; interactions: InteractionLibrary }
export type UiServicesFactory = (context: CommandContext) => UiServices;

/** The shared library is managed at workspace scope even while a project is open. */
export function componentsCommand(services: UiServicesFactory): Command {
  return {
    id: 'components', description: 'Manage and validate a shared Markdown UI component library.',
    usage: 'components [list | init | inspect <id> | validate | create <id> [--tag div] | import [--from directory] | export [--out directory]] [--library directory] [--interactions-library directory]',
    ...libraryMetadata('component'),
    options: { ...libraryOptions, tag: option.string('Root element tag for create.', { default: 'div' }), 'interactions-library': option.string('Interaction library directory used to validate component interactions.') },
    errors: ['INVALID_UI', 'INVALID_UI_LIBRARY', 'DUPLICATE_UI_COMPONENT', 'UNKNOWN_UI_COMPONENT', 'CYCLIC_UI_COMPONENT', 'UNKNOWN_INTERACTION', 'CONFLICT'],
    async run(args, flags, context) {
      const { settings, components: library } = services(context);
      const action = args[0] ?? 'list', directory = value(flags, 'library') ?? settings.components;
      const interactionDirectory = value(flags, 'interactions-library') ?? settings.interactions;
      ensure(flags.from === undefined || action === 'import', 'INVALID_ARGUMENT', '--from requires components import.');
      ensure(flags.out === undefined || action === 'export', 'INVALID_ARGUMENT', '--out requires components export.');
      ensure(flags.tag === undefined || action === 'create', 'INVALID_ARGUMENT', '--tag requires components create.');
      if (action === 'list') {
        arity(args, 0, 1);
        const definitions = await library.list(directory, interactionDirectory);
        return localizedLibraryResult('components', context, { directory, count: definitions.length, status: definitions.length ? 'ready' : 'empty', ...(!definitions.length ? { nextStep: `Run components init --library ${directory}, or add a Markdown component definition.` } : {}), components: definitions.map(definition => ({
          id: definition.id, name: definition.name, sourcePath: definition.sourcePath,
          descriptionSummary: definition.description.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim() ?? '',
          propNames: Object.keys(definition.props).sort(), dependencies: componentDependencies(definition.root),
        })) });
      }
      if (action === 'init') { arity(args, 1); return { directory, ...await library.init(directory, interactionDirectory) }; }
      if (action === 'inspect') { arity(args, 2); return library.inspect(directory, args[1]!, interactionDirectory); }
      if (action === 'validate') { arity(args, 1); return localizedLibraryResult('components', context, await library.validate(directory, interactionDirectory)); }
      if (action === 'create') { arity(args, 2); return library.create(directory, args[1]!, value(flags, 'tag') ?? 'div', interactionDirectory); }
      if (action === 'import') { arity(args, 1); return library.import(value(flags, 'from') ?? settings.componentImports, directory, interactionDirectory); }
      ensure(action === 'export', 'INVALID_ARGUMENT', 'Use components list, init, inspect, validate, create, import, or export.');
      arity(args, 1); return library.export(directory, value(flags, 'out') ?? settings.componentExports, interactionDirectory);
    },
  };
}
