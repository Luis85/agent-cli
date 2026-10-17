import type { PluginErrorDefinition } from '../../../application/plugins/plugin-catalog.ts';

const germanRegenerateHint = 'Führen Sie denselben Befehl mit --plan aus, prüfen Sie die Änderungen und generieren Sie dann neu.';

/** The failure codes the ui plugin registers; their categories fix the exit statuses. */
export const uiErrors: PluginErrorDefinition[] = [
  { code: 'UI_DRIFT', category: 'drift', summary: 'Generated UI files are missing or differ from their definitions.', hint: 'Run the same command with --plan to review, then regenerate.' },
  { code: 'INVALID_UI', category: 'input', summary: 'A component definition is invalid.', hint: 'Fix the definition named in the message; run components validate.' },
  { code: 'INVALID_UI_LIBRARY', category: 'input', summary: 'The component library is invalid.', hint: 'Run components validate and fix the reported definitions.' },
  { code: 'INVALID_UI_FRAMEWORK', category: 'input', summary: 'The UI target is not supported.', hint: 'Use html, htmx, vanilla, vue, svelte, react or angular.' },
  { code: 'EMPTY_UI_LIBRARY', category: 'input', summary: 'The component library has no definitions.', hint: 'Run components init or add a Markdown definition.' },
  { code: 'DUPLICATE_UI_COMPONENT', category: 'input', summary: 'Two component definitions share an id.', hint: 'Give each component a unique id.' },
  { code: 'UNKNOWN_UI_COMPONENT', category: 'input', summary: 'The component is not defined.', hint: 'Run components list and use an existing id.' },
  { code: 'CYCLIC_UI_COMPONENT', category: 'input', summary: 'Component references form a cycle.', hint: 'Remove the cyclic reference named in the message.' },
  { code: 'UI_RENDERER_UNAVAILABLE', category: 'input', summary: 'No renderer is available for this UI target.', hint: 'Choose a supported --framework.' },
  { code: 'INVALID_INTERACTION', category: 'input', summary: 'An interaction definition is invalid.', hint: 'Fix the event, actions or bindings named in the message; run interactions validate.' },
  { code: 'DUPLICATE_INTERACTION', category: 'input', summary: 'Two interaction definitions share an id.', hint: 'Give each interaction a unique id.' },
  { code: 'EMPTY_INTERACTION_LIBRARY', category: 'input', summary: 'The interaction library has no definitions.', hint: 'Run interactions init or add a Markdown definition.' },
  { code: 'UNKNOWN_INTERACTION', category: 'input', summary: 'The interaction is not defined.', hint: 'Run interactions list and check the component\'s interaction references.' },
];

/** German summaries and next steps of the ui plugin's failure codes. */
export const germanUiErrors: Record<string, { summary: string; hint: string }> = {
  UI_DRIFT: { summary: 'Generierte UI-Dateien fehlen oder weichen von den Definitionen ab.', hint: germanRegenerateHint },
  INVALID_UI: { summary: 'Eine Komponentendefinition ist ungültig.', hint: 'Korrigieren Sie die genannte Definition; prüfen Sie mit components validate.' },
  INVALID_UI_LIBRARY: { summary: 'Die Komponentenbibliothek ist ungültig.', hint: 'Führen Sie components validate aus und korrigieren Sie die gemeldeten Definitionen.' },
  INVALID_UI_FRAMEWORK: { summary: 'Das UI-Ziel wird nicht unterstützt.', hint: 'Verwenden Sie html, htmx, vanilla, vue, svelte, react oder angular.' },
  EMPTY_UI_LIBRARY: { summary: 'Die Komponentenbibliothek enthält keine Definitionen.', hint: 'Führen Sie components init aus oder fügen Sie eine Markdown-Definition hinzu.' },
  DUPLICATE_UI_COMPONENT: { summary: 'Zwei Komponentendefinitionen haben dieselbe ID.', hint: 'Vergeben Sie für jede Komponente eine eindeutige ID.' },
  UNKNOWN_UI_COMPONENT: { summary: 'Die Komponente ist nicht definiert.', hint: 'Führen Sie components list aus und verwenden Sie eine vorhandene ID.' },
  CYCLIC_UI_COMPONENT: { summary: 'Die Komponentenreferenzen bilden einen Zyklus.', hint: 'Entfernen Sie die in der Meldung genannte zyklische Referenz.' },
  UI_RENDERER_UNAVAILABLE: { summary: 'Für dieses UI-Ziel ist kein Generator verfügbar.', hint: 'Wählen Sie ein unterstütztes --framework.' },
  INVALID_INTERACTION: { summary: 'Eine Interaktionsdefinition ist ungültig.', hint: 'Korrigieren Sie das genannte Ereignis, die Aktionen oder Bindungen; prüfen Sie mit interactions validate.' },
  DUPLICATE_INTERACTION: { summary: 'Zwei Interaktionsdefinitionen haben dieselbe ID.', hint: 'Vergeben Sie für jede Interaktion eine eindeutige ID.' },
  EMPTY_INTERACTION_LIBRARY: { summary: 'Die Interaktionsbibliothek enthält keine Definitionen.', hint: 'Führen Sie interactions init aus oder fügen Sie eine Markdown-Definition hinzu.' },
  UNKNOWN_INTERACTION: { summary: 'Die Interaktion ist nicht definiert.', hint: 'Führen Sie interactions list aus und prüfen Sie die Interaktionsreferenzen der Komponente.' },
};
