import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { PluginContext } from '../../application/plugins/registry.ts';
import { DataSourceLibrary } from './application/library.ts';
import { dataSourceSettings, dataSourceSettingsIssues, dataSourceSettingsSchema } from './application/settings.ts';
import { MarkdownDataSourceDefinitions } from './infrastructure/definitions.ts';
import { TypeScriptDataSourceRenderer } from './infrastructure/generator.ts';
import { dataSourceGenerator, dataSourcesCommand, type DataSourceServicesFactory } from './presentation/commands.ts';

/** The definition library lives at workspace scope (`context.environment`), even while a project is selected. */
const services: DataSourceServicesFactory = context => {
  const workspace = context.environment;
  return {
    settings: dataSourceSettings((context as PluginContext).settings),
    library: new DataSourceLibrary(workspace, new MarkdownDataSourceDefinitions(workspace.codec), new TypeScriptDataSourceRenderer()),
  };
};

/** The library actions of `data-sources` in German. */
const actions = {
  'data-sources list': 'Die Datenquellendefinitionen der Bibliothek auflisten.',
  'data-sources init': 'Die Bibliothek mit Datenquellendefinitionen als Ausgangspunkt anlegen.',
  'data-sources inspect': 'Eine geparste Datenquellendefinition zurückgeben.',
  'data-sources validate': 'Jede Datenquellendefinition prüfen.',
  'data-sources create': 'Eine neue Datenquellendefinition anlegen.',
  'data-sources import': 'Datenquellendefinitionen aus dem Importverzeichnis in die Bibliothek kopieren.',
  'data-sources export': 'Die Datenquellendefinitionen der Bibliothek in das Exportverzeichnis kopieren.',
};

/**
 * The `data-sources` core plugin: Markdown REST and local-JSON data-source definitions (`data-sources`) and the
 * generator of typed adapters with deterministic test data (`make data-source`). Settings live in
 * `plugins.settings.data-sources`: the library, import, export, adapter and test-data folders.
 */
export const dataSourcesPlugin: CorePlugin = {
  manifest: {
    id: 'data-sources', name: 'Data sources', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Markdown REST and local-JSON data-source definitions with typed adapters and deterministic test data.',
  },
  create: () => ({
    commands: [dataSourcesCommand(services)],
    generators: [dataSourceGenerator(services)],
    settings: dataSourceSettingsSchema,
    validateSettings: dataSourceSettingsIssues,
    strings: {
      de: {
        commands: { 'data-sources': 'Markdown-Datenquellen verwalten, prüfen, importieren und exportieren.' },
        actions,
        generators: { 'data-source': 'Typisierten REST- oder lokalen JSON-Adapter mit deterministischen Testdaten aus Markdown generieren.' },
        messages: { emptyLibrary: 'Führen Sie {command} init --library {directory} aus oder fügen Sie eine Markdown-Definition hinzu.' },
      },
    },
  }),
};
