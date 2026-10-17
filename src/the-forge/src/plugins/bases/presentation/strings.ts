import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';
import { germanBasesErrors } from './errors.ts';

/** The bases plugin's German manifest and option and argument descriptions, available while it is disabled. */
export const basesStrings: PluginStrings = {
  de: {
    errors: germanBasesErrors,
    manifest: { name: 'Bases-Abfragen', description: 'Native Obsidian-Bases-Ansichten als Dateirepositorys abfragen, ohne Obsidian auszuführen.' },
    descriptions: {
      'View name for query; the first view when omitted.': 'Ansichtsname für query; ohne Angabe die erste Ansicht.',
      'Note used as this file in query expressions.': 'Notiz, die in Abfrageausdrücken als this file dient.',
      'Maximum number of rows for query.': 'Höchstzahl der Zeilen für query.',
      'list (default), inspect, query or capabilities.': 'list (Standard), inspect, query oder capabilities.',
      'The .base file for inspect and query.': 'Die .base-Datei für inspect und query.',
    },
  },
};
