import type { JsonSchema } from '../../../domain/schema/json-schema.ts';

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
/** Every setting is a contained relative folder the host normalizes (`pathSettings`). */
export const dataSourcePathSettings = Object.keys(descriptions) as Array<keyof DataSourceSettings>;

export const dataSourceSettingsSchema: JsonSchema = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries(dataSourcePathSettings.map(key => [key, { type: 'string', minLength: 1, default: defaults[key], description: descriptions[key] }])),
};

/** The effective settings: the host's validated and normalized section, or the defaults without one. */
export function dataSourceSettings(section: Readonly<Record<string, unknown>> | null): DataSourceSettings {
  return { ...defaults, ...section } as DataSourceSettings;
}
