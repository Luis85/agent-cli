import { ensure } from '../../../domain/shared/errors.ts';
import type { CommandContext, Generator } from '../../../application/plugins/registry.ts';
import { option, type CommandFlags } from '../../../application/plugins/command-metadata.ts';
import { value } from '../../../application/plugins/command-input.ts';
import { generationControls, generationOutputPath, libraryGenerationOptions } from '../../../application/generation/controls.ts';
import { uiFrameworks, type UiFramework } from '../domain/components/definition.ts';
import type { UiServicesFactory } from './components.ts';

const uiGenerationOptions = {
  ...libraryGenerationOptions,
  framework: option.string('UI target; defaults to plugins.settings.ui.framework.', { enum: uiFrameworks }),
  stories: option.boolean('Also generate Storybook stories (make ui).'),
  'stories-out': option.string('Stories output directory; defaults to plugins.settings.ui.stories.'),
  'interactions-library': option.string('Interaction library directory; defaults to plugins.settings.ui.interactions.'),
};

async function makeUi(kind: 'ui' | 'stories', id: string, flags: CommandFlags, context: CommandContext, services: UiServicesFactory) {
  const ui = services(context), settings = ui.settings;
  const framework = value(flags, 'framework') ?? settings.framework;
  ensure(uiFrameworks.includes(framework as UiFramework), 'INVALID_UI_FRAMEWORK', `--framework must be one of: ${uiFrameworks.join(', ')}.`);
  const storybook = kind === 'stories' || flags.stories === true;
  ensure(storybook || flags['stories-out'] === undefined, 'INVALID_ARGUMENT', '--stories-out requires --stories or make stories.');
  ensure(kind !== 'stories' || flags.stories === undefined, 'INVALID_ARGUMENT', 'make stories already generates stories; omit --stories.');
  const scoped = (path: string) => generationOutputPath(path, context.project);
  const directory = value(flags, 'library') ?? settings.components;
  const { mode, manifestPath, revisions } = await generationControls(flags, context.workspace.files);
  const options = {
    component: id, framework: framework as UiFramework,
    interactionDirectory: value(flags, 'interactions-library') ?? settings.interactions,
    outputDirectory: scoped(value(flags, 'out') ?? settings.output),
    ...(storybook ? { storiesDirectory: scoped(value(flags, 'stories-out') ?? settings.stories) } : {}),
    storybook, storiesOnly: kind === 'stories',
    ...(revisions ? { revisions } : {}),
  };
  if (mode !== 'generate') {
    const result = mode === 'check' ? await ui.components.check(directory, options) : await ui.components.plan(directory, options, manifestPath === undefined ? undefined : scoped(manifestPath));
    return { generator: kind, library: directory, ...(mode === 'check' ? { check: true } : { plan: true }), ...result };
  }
  return { generator: kind, library: directory, ...await ui.components.generate(directory, options) };
}

/**
 * `make ui` and `make stories` render the workspace component library into the output project: the selected one, or
 * the one `--project` names for this invocation. `make` adds `--out` and the review controls.
 */
export function uiGenerators(services: UiServicesFactory): Generator[] {
  const library = { projectOption: 'project', review: true, options: uiGenerationOptions } as const;
  return [
    {
      id: 'ui', description: 'Generate deterministic UI code from Markdown component definitions.', usage: 'make ui <component-id> [--framework target] [--stories] [--project id] [--out directory]',
      ...library, run: ({ name, flags, context }) => makeUi('ui', name, flags, context, services),
    },
    {
      id: 'stories', description: 'Generate native Storybook CSF stories for existing UI components.', usage: 'make stories <component-id> [--framework target] [--project id] [--stories-out directory]',
      ...library, run: ({ name, flags, context }) => makeUi('stories', name, flags, context, services),
    },
  ];
}
