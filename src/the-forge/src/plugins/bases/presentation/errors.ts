import type { PluginErrorDefinition } from '../../../application/plugins/plugin-catalog.ts';

/** The failure codes the bases plugin registers; their categories fix the exit statuses. */
export const basesErrors: PluginErrorDefinition[] = [
  { code: 'INVALID_BASE_QUERY', category: 'input', summary: 'The Bases query is invalid.', hint: 'Check the view, context and expressions named in the message.' },
  { code: 'INVALID_BASE_EXPRESSION', category: 'input', summary: 'A Bases expression cannot be parsed.', hint: 'Fix the expression named in the message.' },
  { code: 'BASE_EVALUATION_ERROR', category: 'input', summary: 'A Bases expression failed while evaluating a file.', hint: 'Check the view, file and expression named in the message.' },
  { code: 'BASE_TIMEOUT', category: 'input', summary: 'A Bases query exceeded its expression evaluation time budget.', hint: 'Simplify the expressions of the .base file named in the message (avoid nested regular-expression quantifiers such as (a+)+) or narrow its filters.' },
  { code: 'BASE_VIEW_NOT_FOUND', category: 'input', summary: 'The requested Bases view does not exist.', hint: 'Run bases inspect <file.base> and pass an existing --view.' },
  { code: 'BASE_CONTEXT_NOT_FOUND', category: 'input', summary: 'The context file is not an indexed vault file.', hint: 'Pass an existing vault file to --context.' },
  { code: 'INVALID_BASE_PROPERTY_TYPES', category: 'input', summary: 'The Obsidian property type registry is invalid.', hint: 'Fix .obsidian/types.json so it is a JSON object of property types.' },
  { code: 'UNSUPPORTED_BASE_PROPERTY_TYPE', category: 'input', summary: 'An Obsidian property type is not supported.', hint: 'Use a supported type in .obsidian/types.json.' },
];

/** German summaries and next steps of the bases plugin's failure codes. */
export const germanBasesErrors: Record<string, { summary: string; hint: string }> = {
  INVALID_BASE_QUERY: { summary: 'Die Bases-Abfrage ist ungültig.', hint: 'Prüfen Sie die in der Meldung genannte Ansicht, den Kontext und die Ausdrücke.' },
  INVALID_BASE_EXPRESSION: { summary: 'Ein Bases-Ausdruck kann nicht geparst werden.', hint: 'Korrigieren Sie den in der Meldung genannten Ausdruck.' },
  BASE_EVALUATION_ERROR: { summary: 'Ein Bases-Ausdruck ist bei der Auswertung einer Datei fehlgeschlagen.', hint: 'Prüfen Sie die in der Meldung genannte Ansicht, Datei und den Ausdruck.' },
  BASE_TIMEOUT: { summary: 'Eine Bases-Abfrage hat ihr Zeitbudget für die Auswertung von Ausdrücken überschritten.', hint: 'Vereinfachen Sie die Ausdrücke der in der Meldung genannten .base-Datei (vermeiden Sie verschachtelte Quantoren in regulären Ausdrücken wie (a+)+) oder grenzen Sie ihre Filter ein.' },
  BASE_VIEW_NOT_FOUND: { summary: 'Die angeforderte Bases-Ansicht existiert nicht.', hint: 'Führen Sie bases inspect <file.base> aus und übergeben Sie eine vorhandene --view.' },
  BASE_CONTEXT_NOT_FOUND: { summary: 'Die Kontextdatei ist keine indexierte Vault-Datei.', hint: 'Übergeben Sie eine vorhandene Vault-Datei an --context.' },
  INVALID_BASE_PROPERTY_TYPES: { summary: 'Das Register der Obsidian-Eigenschaftstypen ist ungültig.', hint: 'Korrigieren Sie .obsidian/types.json zu einem JSON-Objekt mit Eigenschaftstypen.' },
  UNSUPPORTED_BASE_PROPERTY_TYPE: { summary: 'Ein Obsidian-Eigenschaftstyp wird nicht unterstützt.', hint: 'Verwenden Sie in .obsidian/types.json einen unterstützten Typ.' },
};
