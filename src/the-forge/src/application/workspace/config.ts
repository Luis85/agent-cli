import type { EventOutput } from '../plugins/event-output.ts';

/** Library paths are workspace-relative; UI/story paths follow the active project. Bin locations are fixed. */
export interface AppConfig {
  schemaVersion: 1;
  paths: {
    projects: string; components: string; ui: string; stories: string; componentImports: string; componentExports: string;
    dataSources: string; dataGenerated: string; dataFixtures: string; dataImports: string; dataExports: string;
    interactions: string; interactionImports: string; interactionExports: string;
  };
  settings: { json: boolean; dryRun: boolean; language: 'en' | 'de'; events: EventOutput };
  /** `enabled` user plugins in load order, `disabled` bundled core plugins, and each plugin's settings section. */
  plugins: { enabled: string[]; disabled: string[]; settings: Record<string, unknown> };
  ui: { framework: 'html' | 'htmx' | 'vanilla' | 'vue' | 'svelte' | 'react' | 'angular' };
}
export interface LoadedConfig { path: string | null; root: string; config: AppConfig }
