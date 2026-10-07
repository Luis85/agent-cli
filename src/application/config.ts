/** Effective environment configuration. The projects directory is workspace-relative; bin locations are fixed. */
export interface AppConfig {
  schemaVersion: 1;
  paths: { projects: string };
  settings: { json: boolean; dryRun: boolean };
  templates: { dateFormat: string; timeFormat: string };
  plugins: { enabled: string[] };
}
export interface LoadedConfig { path: string | null; root: string; config: AppConfig }
