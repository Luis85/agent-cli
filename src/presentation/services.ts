import type { FileRepository } from '../application/ports.ts';
import type { LoadedConfig } from '../application/config.ts';
import type { DocumentTemplates } from '../application/templates.ts';
import type { ProjectService } from '../application/projects.ts';
import type { UiLibrary } from '../application/ui.ts';
import type { DataSourceLibrary } from '../application/data-sources.ts';
import type { InteractionLibrary } from '../application/interactions.ts';

export interface WorkflowServices {
  loaded: LoadedConfig;
  files: FileRepository;
  templates: DocumentTemplates;
  projects: ProjectService;
  uiLibrary: UiLibrary;
  dataSources: DataSourceLibrary;
  interactions: InteractionLibrary;
  installTemplates(): Promise<unknown>;
  setup(): Promise<unknown>;
}
