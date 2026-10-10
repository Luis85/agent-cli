import type { FileRepository } from '../../application/workspace/ports.ts';
import type { LoadedConfig } from '../../application/workspace/config.ts';
import type { DocumentTemplates } from '../../application/templates/templates.ts';
import type { ProjectService } from '../../application/projects/projects.ts';
import type { WorkflowSync } from '../../application/workflows/workflows.ts';
import type { InstalledPlugin } from '../../application/plugins/core-plugins.ts';
import type { SettingsSection } from '../../application/plugins/plugin-settings.ts';

export interface WorkflowServices {
  loaded: LoadedConfig;
  files: FileRepository;
  templates: DocumentTemplates;
  projects: ProjectService;
  workflows: WorkflowSync;
  /** Plugin config sections the registered plugins declare. */
  configSections(): SettingsSection[];
  /** User plugin directories under `bin/plugins` with valid manifests. */
  installedPlugins(): Promise<InstalledPlugin[]>;
  installTemplates(): Promise<unknown>;
  setup(): Promise<unknown>;
}
