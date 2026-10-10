import type { JsonSchema } from '../../../domain/schema/json-schema.ts';
import { relativePathIssues, relativePathSetting } from '../../../application/plugins/plugin-settings.ts';
import { uiFrameworks, type UiFramework } from '../domain/components/definition.ts';

/**
 * `plugins.settings.ui`: the default UI target and the workspace-relative library, import and export folders of
 * components and interactions, plus the generated UI and Storybook story folders, which follow the output project.
 */
export interface UiSettings {
  framework: UiFramework;
  components: string; componentImports: string; componentExports: string;
  interactions: string; interactionImports: string; interactionExports: string;
  output: string; stories: string;
}

const defaults: UiSettings = {
  framework: 'html',
  components: 'components', componentImports: 'imports/components', componentExports: 'exports/components',
  interactions: 'interactions', interactionImports: 'imports/interactions', interactionExports: 'exports/interactions',
  output: 'src/ui', stories: 'stories',
};
const descriptions: Record<Exclude<keyof UiSettings, 'framework'>, string> = {
  components: 'Workspace-relative component library folder.',
  componentImports: 'Workspace-relative folder that components import copies definitions from.',
  componentExports: 'Workspace-relative folder that components export copies definitions to.',
  interactions: 'Workspace-relative interaction library folder.',
  interactionImports: 'Workspace-relative folder that interactions import copies definitions from.',
  interactionExports: 'Workspace-relative folder that interactions export copies definitions to.',
  output: 'Generated UI folder, relative to the output project (or the workspace without one).',
  stories: 'Generated Storybook story folder, relative to the output project (or the workspace without one).',
};
const paths = Object.keys(descriptions) as Array<keyof typeof descriptions>;

export const uiSettingsSchema: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    framework: { type: 'string', enum: [...uiFrameworks], default: defaults.framework, description: 'Default UI target of make ui and make stories.' },
    ...Object.fromEntries(paths.map(key => [key, { type: 'string', minLength: 1, default: defaults[key], description: descriptions[key] }])),
  },
};

/** Every folder setting must be a contained workspace-relative path. */
export const uiSettingsIssues = (settings: Readonly<Record<string, unknown>>) => relativePathIssues('ui', settings, paths);

/** The effective settings: the validated section with defaults, and folders without trailing slashes. */
export function uiSettings(section: Readonly<Record<string, unknown>> | null): UiSettings {
  const value = { ...defaults, ...section } as Record<string, unknown>;
  return { ...defaults, framework: value.framework as UiFramework, ...Object.fromEntries(paths.map(key => [key, relativePathSetting(value[key])])) };
}
