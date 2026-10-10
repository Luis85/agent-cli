import type { EventOutput } from '../plugins/event-output.ts';

/**
 * Library paths are workspace-relative; generated output follows the active project. Bin locations are fixed. Feature
 * settings, such as the ui plugin's folders and framework, live in their plugin's section under `plugins.settings`.
 */
export interface AppConfig {
  schemaVersion: 1;
  paths: {
    projects: string;
    dataSources: string; dataGenerated: string; dataFixtures: string; dataImports: string; dataExports: string;
  };
  settings: { json: boolean; dryRun: boolean; language: 'en' | 'de'; events: EventOutput };
  templates: { dateFormat: string; timeFormat: string };
  /** `enabled` user plugins in load order, `disabled` bundled core plugins, and each plugin's settings section. */
  plugins: { enabled: string[]; disabled: string[]; settings: Record<string, unknown> };
}
export interface LoadedConfig { path: string | null; root: string; config: AppConfig }
