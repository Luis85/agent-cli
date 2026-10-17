import type { PluginErrorDefinition } from '../../../application/plugins/plugin-catalog.ts';

/** The failure codes the templates plugin registers; their categories fix the exit statuses. */
export const templateErrors: PluginErrorDefinition[] = [
  { code: 'INVALID_TEMPLATE', category: 'input', summary: 'The Markdown template is invalid.', hint: 'Fix the template frontmatter or placeholders named in the message.' },
  { code: 'INVALID_TEMPLATE_DATE', category: 'input', summary: 'A template date or date format is invalid.', hint: 'Use an ISO date and a supported date format.' },
  { code: 'INVALID_TEMPLATE_PACK', category: 'input', summary: 'The template pack is invalid.', hint: 'Use unique template ids and destinations.' },
  { code: 'INVALID_TEMPLATE_VALUES', category: 'input', summary: 'Template values are missing or have the wrong type.', hint: 'Run templates inspect <template.md> and supply its required values.' },
  { code: 'UNKNOWN_TEMPLATE_VARIABLE', category: 'input', summary: 'The template uses an undeclared variable.', hint: 'Declare the variable in the template or remove the placeholder; run templates inspect <template.md>.' },
];

/** German summaries and next steps of the templates plugin's failure codes. */
export const germanTemplateErrors: Record<string, { summary: string; hint: string }> = {
  INVALID_TEMPLATE: { summary: 'Die Markdown-Vorlage ist ungültig.', hint: 'Korrigieren Sie das in der Meldung genannte Frontmatter oder die Platzhalter.' },
  INVALID_TEMPLATE_DATE: { summary: 'Ein Datum oder Datumsformat der Vorlage ist ungültig.', hint: 'Verwenden Sie ein ISO-Datum und ein unterstütztes Datumsformat.' },
  INVALID_TEMPLATE_PACK: { summary: 'Das Vorlagenpaket ist ungültig.', hint: 'Verwenden Sie eindeutige Vorlagen-IDs und Zielpfade.' },
  INVALID_TEMPLATE_VALUES: { summary: 'Vorlagenwerte fehlen oder haben den falschen Typ.', hint: 'Führen Sie templates inspect <template.md> aus und geben Sie die Pflichtwerte an.' },
  UNKNOWN_TEMPLATE_VARIABLE: { summary: 'Die Vorlage verwendet eine nicht deklarierte Variable.', hint: 'Deklarieren Sie die Variable oder entfernen Sie den Platzhalter; prüfen Sie mit templates inspect <template.md>.' },
};
