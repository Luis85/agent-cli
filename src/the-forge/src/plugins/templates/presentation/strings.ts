import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';
import { germanTemplateErrors } from './errors.ts';

/** The templates plugin's German manifest and option, argument and settings descriptions. */
export const templatesStrings: PluginStrings = {
  de: {
    errors: germanTemplateErrors,
    manifest: { name: 'Vorlagen', description: 'Obsidian-Markdown-Vorlagen zu Dokumenten rendern und das Planungs-Workflow-Paket installieren.' },
    descriptions: {
      'The template path inside bin/templates, such as prd.md.': 'Der Pfad der Vorlage in bin/templates, etwa prd.md.',
      'The template pack; workflow is the only one.': 'Das Vorlagenpaket; workflow ist das einzige.',
      'Markdown template under bin/templates.': 'Markdown-Vorlage unter bin/templates.',
      'Template values as a JSON object.': 'Vorlagenwerte als JSON-Objekt.',
      'Read template values from a JSON file.': 'Vorlagenwerte aus einer JSON-Datei lesen.',
      'ISO date used for template dates; defaults to today.': 'ISO-Datum für die Datumsangaben der Vorlage; standardmäßig heute.',
      'dayjs format of {{date}} placeholders without their own format.': 'dayjs-Format von {{date}}-Platzhaltern ohne eigenes Format.',
      'dayjs format of {{time}} placeholders without their own format.': 'dayjs-Format von {{time}}-Platzhaltern ohne eigenes Format.',
    },
  },
};
