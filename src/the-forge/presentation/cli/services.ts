import type { FileRepository } from '../../application/workspace/ports.ts';
import type { LoadedConfig } from '../../application/workspace/config.ts';
import type { DocumentTemplates } from '../../application/templates/templates.ts';
import type { ProjectService } from '../../application/projects/projects.ts';
import type { UiLibrary } from '../../application/ui/library.ts';
import type { DataSourceLibrary } from '../../application/data-sources/library.ts';
import type { InteractionLibrary } from '../../application/interactions/library.ts';

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
