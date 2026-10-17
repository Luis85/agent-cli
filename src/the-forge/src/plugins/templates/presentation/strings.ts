import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';
import { germanTemplateErrors } from './errors.ts';

/** The templates plugin's German manifest and option, argument and settings descriptions. */
export const templatesStrings: PluginStrings = {
  de: {
    errors: germanTemplateErrors,
    manifest: { name: 'Vorlagen', description: 'Obsidian-Markdown-Vorlagen zu Dokumenten rendern und das Planungs-Workflow-Paket installieren.' },
    descriptions: {
      'list (default), inspect or install.': 'list (Standard), inspect oder install.',
      'The template for inspect, or the pack (workflow) for install.': 'Die Vorlage für inspect oder das Paket (workflow) für install.',
      'Markdown template under bin/templates.': 'Markdown-Vorlage unter bin/templates.',
      'Template values as a JSON object.': 'Vorlagenwerte als JSON-Objekt.',
      'Read template values from a JSON file.': 'Vorlagenwerte aus einer JSON-Datei lesen.',
      'ISO date used for template dates; defaults to today.': 'ISO-Datum für die Datumsangaben der Vorlage; standardmäßig heute.',
      'dayjs format of {{date}} placeholders without their own format.': 'dayjs-Format von {{date}}-Platzhaltern ohne eigenes Format.',
      'dayjs format of {{time}} placeholders without their own format.': 'dayjs-Format von {{time}}-Platzhaltern ohne eigenes Format.',
    },
  },
};
