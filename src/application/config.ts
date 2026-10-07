/** Effective invocation configuration. All non-root paths are workspace-relative. */
export interface AppConfig {
  schemaVersion: 1;
  paths: { root: string; projects: string; templates: string; output: string; generated: string; plugins: string; skills: string };
  settings: { json: boolean; dryRun: boolean };
  templates: { dateFormat: string; timeFormat: string };
  plugins: { enabled: string[] };
}
export interface LoadedConfig { path: string | null; config: AppConfig }
