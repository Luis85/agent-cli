import type { PluginErrorDefinition } from '../../../application/plugins/plugin-catalog.ts';

const germanRegenerateHint = 'Führen Sie denselben Befehl mit --plan aus, prüfen Sie die Änderungen und generieren Sie dann neu.';

/** The failure codes the data-sources plugin registers; their categories fix the exit statuses. */
export const dataSourceErrors: PluginErrorDefinition[] = [
  { code: 'DATA_SOURCE_DRIFT', category: 'drift', summary: 'Generated data-source files are missing or differ from their definitions.', hint: 'Run the same command with --plan to review, then regenerate.' },
  { code: 'INVALID_DATA_SOURCE', category: 'input', summary: 'A data-source definition is invalid.', hint: 'Fix the fields named in the message; run data-sources validate.' },
  { code: 'DUPLICATE_DATA_SOURCE', category: 'input', summary: 'Two data-source definitions share an id.', hint: 'Give each data source a unique id.' },
  { code: 'EMPTY_DATA_SOURCE_LIBRARY', category: 'input', summary: 'The data-source library has no definitions.', hint: 'Run data-sources init or add a Markdown definition.' },
  { code: 'UNKNOWN_DATA_SOURCE', category: 'input', summary: 'The data source is not defined.', hint: 'Run data-sources list and use an existing id.' },
  { code: 'DATA_SOURCE_RENDERER_UNAVAILABLE', category: 'input', summary: 'No generator is available for this data source.', hint: 'Use a supported data-source kind; run help make for data-source generation.' },
];

/** German summaries and next steps of the data-sources plugin's failure codes. */
export const germanDataSourceErrors: Record<string, { summary: string; hint: string }> = {
  DATA_SOURCE_DRIFT: { summary: 'Generierte Datenquellendateien fehlen oder weichen von den Definitionen ab.', hint: germanRegenerateHint },
  INVALID_DATA_SOURCE: { summary: 'Eine Datenquellendefinition ist ungültig.', hint: 'Korrigieren Sie die genannten Felder; prüfen Sie mit data-sources validate.' },
  DUPLICATE_DATA_SOURCE: { summary: 'Zwei Datenquellendefinitionen haben dieselbe ID.', hint: 'Vergeben Sie für jede Datenquelle eine eindeutige ID.' },
  EMPTY_DATA_SOURCE_LIBRARY: { summary: 'Die Datenquellenbibliothek enthält keine Definitionen.', hint: 'Führen Sie data-sources init aus oder fügen Sie eine Markdown-Definition hinzu.' },
  UNKNOWN_DATA_SOURCE: { summary: 'Die Datenquelle ist nicht definiert.', hint: 'Führen Sie data-sources list aus und verwenden Sie eine vorhandene ID.' },
  DATA_SOURCE_RENDERER_UNAVAILABLE: { summary: 'Für diese Datenquelle ist kein Generator verfügbar.', hint: 'Verwenden Sie eine unterstützte Datenquellenart; Hinweise zur Generierung zeigt help make.' },
};
