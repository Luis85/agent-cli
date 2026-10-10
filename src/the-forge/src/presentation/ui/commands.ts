import { ensure } from '../../domain/shared/errors.ts';
import { uiFrameworks, type UiFramework } from '../../domain/ui/definition.ts';
import { componentDependencies } from '../../domain/ui/library.ts';
import type { Command, CommandContext } from '../../application/plugins/registry.ts';
import type { WorkflowServices } from '../cli/services.ts';
import { generationControls, generationOutputPath } from '../generation/controls.ts';
import { arity, value } from '../../application/plugins/command-input.ts';
import { option } from '../../application/plugins/command-metadata.ts';
import { libraryMetadata, libraryOptions } from '../cli/library-metadata.ts';

export const uiGenerationOptions = {
  framework: option.string('UI target; defaults to ui.framework.', { enum: uiFrameworks }),
  stories: option.boolean('Also generate Storybook stories (make ui).'),
  'stories-out': option.string('Stories output directory; defaults to paths.stories.'),
  'interactions-library': option.string('Interaction library directory; defaults to paths.interactions.'),
};

export async function makeUi(kind: 'ui' | 'stories', id: string, flags: Record<string, string | boolean>, context: CommandContext, services: WorkflowServices) {
  const config = services.loaded.config;
  const framework = value(flags, 'framework') ?? config.ui.framework;
  ensure(uiFrameworks.includes(framework as UiFramework), 'INVALID_UI_FRAMEWORK', `--framework must be one of: ${uiFrameworks.join(', ')}.`);
  const storybook = kind === 'stories' || flags.stories === true;
  ensure(storybook || flags['stories-out'] === undefined, 'INVALID_ARGUMENT', '--stories-out requires --stories or make stories.');
  ensure(kind !== 'stories' || flags.stories === undefined, 'INVALID_ARGUMENT', 'make stories already generates stories; omit --stories.');
  const scoped = (path: string) => generationOutputPath(path, context.project);
  const directory = value(flags, 'library') ?? config.paths.components;
  const { mode, manifestPath, revisions } = await generationControls(flags, context.workspace.files);
  const options = {
    component: id, framework: framework as UiFramework,
    interactionDirectory: value(flags, 'interactions-library') ?? config.paths.interactions,
    outputDirectory: scoped(value(flags, 'out') ?? config.paths.ui),
    ...(storybook ? { storiesDirectory: scoped(value(flags, 'stories-out') ?? config.paths.stories) } : {}),
    storybook, storiesOnly: kind === 'stories',
    ...(revisions ? { revisions } : {}),
  };
  if (mode !== 'generate') {
    const result = mode === 'check' ? await services.uiLibrary.check(directory, options) : await services.uiLibrary.plan(directory, options, manifestPath === undefined ? undefined : scoped(manifestPath));
    return { generator: kind, library: directory, ...(mode === 'check' ? { check: true } : { plan: true }), ...result };
  }
  return { generator: kind, library: directory, ...await services.uiLibrary.generate(directory, options) };
}

/** The shared library is managed at workspace scope even while a project is open. */
export function uiCommands(services: WorkflowServices): Command[] {
  const config = services.loaded.config;
  return [{
    id: 'components', description: 'Manage and validate a shared Markdown UI component library.',
    usage: 'components [list | init | inspect <id> | validate | create <id> [--tag div] | import [--from directory] | export [--out directory]] [--library directory] [--interactions-library directory]',
    ...libraryMetadata('component'),
    options: { ...libraryOptions, tag: option.string('Root element tag for create.', { default: 'div' }), 'interactions-library': option.string('Interaction library directory used to validate component interactions.') },
    errors: ['INVALID_UI', 'INVALID_UI_LIBRARY', 'DUPLICATE_UI_COMPONENT', 'UNKNOWN_UI_COMPONENT', 'CYCLIC_UI_COMPONENT', 'UNKNOWN_INTERACTION', 'CONFLICT'],
    async run(args, flags) {
      const action = args[0] ?? 'list', directory = value(flags, 'library') ?? config.paths.components;
      const interactionDirectory = value(flags, 'interactions-library') ?? config.paths.interactions;
      ensure(flags.from === undefined || action === 'import', 'INVALID_ARGUMENT', '--from requires components import.');
      ensure(flags.out === undefined || action === 'export', 'INVALID_ARGUMENT', '--out requires components export.');
      ensure(flags.tag === undefined || action === 'create', 'INVALID_ARGUMENT', '--tag requires components create.');
      const library = services.uiLibrary;
      if (action === 'list') {
        arity(args, 0, 1);
        const definitions = await library.list(directory, interactionDirectory);
        return { directory, count: definitions.length, status: definitions.length ? 'ready' : 'empty', ...(!definitions.length ? { nextStep: `Run components init --library ${directory}, or add a Markdown component definition.` } : {}), components: definitions.map(definition => ({
          id: definition.id, name: definition.name, sourcePath: definition.sourcePath,
          descriptionSummary: definition.description.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim() ?? '',
          propNames: Object.keys(definition.props).sort(), dependencies: componentDependencies(definition.root),
        })) };
      }
      if (action === 'init') { arity(args, 1); return { directory, ...await library.init(directory, interactionDirectory) }; }
      if (action === 'inspect') { arity(args, 2); return library.inspect(directory, args[1]!, interactionDirectory); }
      if (action === 'validate') { arity(args, 1); return library.validate(directory, interactionDirectory); }
      if (action === 'create') { arity(args, 2); return library.create(directory, args[1]!, value(flags, 'tag') ?? 'div', interactionDirectory); }
      if (action === 'import') { arity(args, 1); return library.import(value(flags, 'from') ?? config.paths.componentImports, directory, interactionDirectory); }
      ensure(action === 'export', 'INVALID_ARGUMENT', 'Use components list, init, inspect, validate, create, import, or export.');
      arity(args, 1); return library.export(directory, value(flags, 'out') ?? config.paths.componentExports, interactionDirectory);
    },
  }];
}
