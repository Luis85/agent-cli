import type { JsonSchema } from '../../../domain/schema/json-schema.ts';
import { relativePathIssues, relativePathSetting } from '../../../application/plugins/plugin-settings.ts';

/**
 * `plugins.settings.data-sources`: the workspace-relative definition library and its import and export folders, and
 * the adapter and test-data folders, which follow the output project.
 */
export interface DataSourceSettings { library: string; imports: string; exports: string; output: string; fixtures: string }

const defaults: DataSourceSettings = {
  library: 'data-sources', imports: 'imports/data-sources', exports: 'exports/data-sources', output: 'src/data-sources', fixtures: 'test-data',
};
const descriptions: Record<keyof DataSourceSettings, string> = {
  library: 'Workspace-relative data-source definition library folder.',
  imports: 'Workspace-relative folder that data-sources import copies definitions from.',
  exports: 'Workspace-relative folder that data-sources export copies definitions to.',
  output: 'Generated adapter folder, relative to the output project (or the workspace without one).',
  fixtures: 'Generated test-data folder, relative to the output project (or the workspace without one).',
};
const paths = Object.keys(descriptions) as Array<keyof DataSourceSettings>;

export const dataSourceSettingsSchema: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(paths.map(key => [key, { type: 'string', minLength: 1, default: defaults[key], description: descriptions[key] }])),
};

/** Every folder setting must be a contained workspace-relative path. */
export const dataSourceSettingsIssues = (settings: Readonly<Record<string, unknown>>) => relativePathIssues('data-sources', settings, paths);

/** The effective settings: the validated section with defaults, and folders without trailing slashes. */
export function dataSourceSettings(section: Readonly<Record<string, unknown>> | null): DataSourceSettings {
  const value = { ...defaults, ...section } as Record<string, unknown>;
  return Object.fromEntries(paths.map(key => [key, relativePathSetting(value[key])])) as unknown as DataSourceSettings;
}
