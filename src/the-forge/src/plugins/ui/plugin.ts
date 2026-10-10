import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { PluginContext } from '../../application/plugins/registry.ts';
import type { UiRenderer } from './application/components/library.ts';
import { UiLibrary } from './application/components/library.ts';
import { InteractionLibrary } from './application/interactions/library.ts';
import { uiSettings, uiSettingsIssues, uiSettingsSchema } from './application/settings.ts';
import { MarkdownUiDefinitions } from './infrastructure/components/definitions.ts';
import { standardUiCatalog } from './infrastructure/components/catalog.ts';
import { componentArtifact, renderUiComponents } from './infrastructure/components/renderers.ts';
import { renderUiStories } from './infrastructure/components/stories.ts';
import { MarkdownInteractionDefinitions } from './infrastructure/interactions/definitions.ts';
import { componentsCommand, type UiServicesFactory } from './presentation/components.ts';
import { interactionsCommand } from './presentation/interactions.ts';
import { uiGenerators } from './presentation/generators.ts';
import { de } from './presentation/strings.ts';

/** Framework components and Storybook stories for the seven UI targets. */
const renderer: UiRenderer = {
  componentPaths: (definitions, options) => definitions.map(definition => `${options.outputDirectory}/${componentArtifact(definition, options.framework).fileName}`),
  generate: (definitions, options) => [
    ...(options.storiesOnly ? [] : renderUiComponents(definitions, options.framework, options.outputDirectory, options.interactions)),
    ...(options.storybook ? renderUiStories(definitions, options.framework, options.outputDirectory, options.storiesDirectory!) : []),
  ],
};

/** The libraries live at workspace scope (`context.environment`), even while a project is selected. */
const services: UiServicesFactory = context => {
  const settings = uiSettings((context as PluginContext).settings), workspace = context.environment;
  const interactions = new InteractionLibrary(workspace, new MarkdownInteractionDefinitions(workspace.codec));
  const components = new UiLibrary(workspace, new MarkdownUiDefinitions(workspace.codec), standardUiCatalog, renderer, interactions, settings.interactions);
  return { settings, components, interactions };
};

/**
 * The `ui` core plugin: the Markdown component and interaction libraries (`components`, `interactions`) and the
 * deterministic UI and Storybook generators (`make ui`, `make stories`) for html, htmx, vanilla, vue, svelte, react
 * and angular. Interactions belong here because the renderers emit their handlers. Settings live in
 * `plugins.settings.ui`: the default `framework` and the library, import, export and output folders.
 */
export const uiPlugin: CorePlugin = {
  manifest: {
    id: 'ui', name: 'UI', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Markdown component and interaction libraries with deterministic UI and Storybook generation for seven targets.',
  },
  create: () => ({
    commands: [componentsCommand(services), interactionsCommand(services)],
    generators: uiGenerators(services),
    settings: uiSettingsSchema,
    validateSettings: uiSettingsIssues,
    strings: { de },
  }),
};
