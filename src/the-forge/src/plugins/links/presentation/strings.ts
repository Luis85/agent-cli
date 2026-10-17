import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

/** The links plugin's German manifest and option, argument and settings descriptions, available while it is disabled. */
export const linksStrings: PluginStrings = {
  de: {
    manifest: { name: 'Linkberichte', description: 'Ausgehende Links, Backlinks, nicht aufgelöste Links, verwaiste Notizen und Sackgassen aus dem Metadaten-Cache melden.' },
    descriptions: {
      'For unresolved, orphans and deadends: only files whose root-relative path matches this glob, or that are this file or below this folder.': 'Für unresolved, orphans und deadends: nur Dateien, deren Pfad relativ zum Stammverzeichnis diesem Glob entspricht oder die diese Datei sind oder unter diesem Ordner liegen.',
      'out, back, unresolved, orphans or deadends.': 'out, back, unresolved, orphans oder deadends.',
      'The vault path of the file for out and back.': 'Der Vault-Pfad der Datei für out und back.',
      'Path globs of entry notes, such as an index or home note, that links orphans never reports.': 'Pfad-Globs von Einstiegsnotizen wie einer Index- oder Startnotiz, die links orphans nie meldet.',
    },
  },
};
