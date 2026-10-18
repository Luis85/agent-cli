import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';
import { germanDataSourceErrors } from './errors.ts';

/** The data-sources plugin's German manifest and option and settings descriptions, available while it is disabled. */
export const dataSourcesStrings: PluginStrings = {
  de: {
    errors: germanDataSourceErrors,
    manifest: { name: 'Datenquellen', description: 'Markdown-Definitionen für REST- und lokale JSON-Datenquellen mit typisierten Adaptern und deterministischen Testdaten.' },
    descriptions: {
      'Data-source kind for create.': 'Art der Datenquelle für create.',
      'Test-data output directory; defaults to plugins.settings.data-sources.fixtures.': 'Ausgabeverzeichnis der Testdaten; standardmäßig plugins.settings.data-sources.fixtures.',
      'Workspace-relative data-source definition library folder.': 'Ordner der Bibliothek mit Datenquellendefinitionen, relativ zum Workspace.',
      'Workspace-relative folder that data-sources import copies definitions from.': 'Ordner relativ zum Workspace, aus dem data-sources import Definitionen kopiert.',
      'Workspace-relative folder that data-sources export copies definitions to.': 'Ordner relativ zum Workspace, in den data-sources export Definitionen kopiert.',
      'Generated adapter folder, relative to the output project (or the workspace without one).': 'Ordner der generierten Adapter, relativ zum Ausgabeprojekt (ohne Projekt zum Workspace).',
      'Generated test-data folder, relative to the output project (or the workspace without one).': 'Ordner der generierten Testdaten, relativ zum Ausgabeprojekt (ohne Projekt zum Workspace).',
    },
  },
};
