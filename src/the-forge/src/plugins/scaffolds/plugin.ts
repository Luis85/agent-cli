import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import { projectScaffolderService, type ProjectScaffolder } from '../../application/projects/projects.ts';
import { scaffoldGenerators } from './infrastructure/generators.ts';
import { componentScaffold, projectScaffold } from './infrastructure/projects.ts';

const projects: ProjectScaffolder = { project: projectScaffold, component: componentScaffold };

/**
 * The `scaffolds` core plugin: the TypeScript code generators `make entity|value-object|use-case|event|form`, the
 * user plugin folder generator `make plugin`, and the generated-project scaffold. It provides
 * `scaffolds.projects`, the files that the kernel's `project create` and `project component` write; with the plugin
 * disabled those two actions fail with PLUGIN_UNAVAILABLE while project selection keeps working.
 */
export const scaffoldsPlugin: CorePlugin = {
  manifest: {
    id: 'scaffolds', name: 'Scaffolds', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Generate tested TypeScript projects, components, domain and application code, typed forms and plugin folders.',
  },
  create: () => ({
    generators: scaffoldGenerators,
    provides: { [projectScaffolderService]: projects },
    strings: {
      de: {
        generators: {
          form: 'Typisierte Formulardefinition mit Zod-Validierung und HTML-Vorschau in einem Forge-Projekt.',
          entity: 'Domain-Entität mit Identität und Prüfung von Invarianten.',
          'value-object': 'Unveränderliches Wertobjekt mit Gleichheitsprüfung und Validierung.',
          'use-case': 'Anwendungsfall mit injiziertem Repository-Port.',
          event: 'Typisierte Ereignisdaten mit Laufzeitbeschreibung.',
          plugin: 'Installierbarer Plugin-Ordner mit Manifest, Befehlsnamensraum und Lebenszyklus-Hooks.',
        },
      },
    },
  }),
};
