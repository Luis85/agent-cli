/** Library paths are workspace-relative; UI/story paths follow the active project. Bin locations are fixed. */
export interface AppConfig {
  schemaVersion: 1;
  paths: {
    projects: string; components: string; ui: string; stories: string; componentImports: string; componentExports: string;
    dataSources: string; dataGenerated: string; dataFixtures: string; dataImports: string; dataExports: string;
  };
  settings: { json: boolean; dryRun: boolean };
  templates: { dateFormat: string; timeFormat: string };
  plugins: { enabled: string[] };
  ui: { framework: 'html' | 'htmx' | 'vanilla' | 'vue' | 'svelte' | 'react' | 'angular' };
}
export interface LoadedConfig { path: string | null; root: string; config: AppConfig }
