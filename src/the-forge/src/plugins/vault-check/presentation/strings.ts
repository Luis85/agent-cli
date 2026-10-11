import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

/** The vault-check plugin's German manifest and option, argument and settings descriptions, available while it is disabled. */
export const vaultCheckStrings: PluginStrings = {
  de: {
    manifest: { name: 'Vault-Prüfung', description: 'Den Vault auf defekte Links, ungültige Dateien und uneinheitliche Eigenschaften prüfen und seine Tags und Eigenschaften auflisten.' },
    descriptions: {
      'check (default), tags or properties.': 'check (Standard), tags oder properties.',
      'Only files whose root-relative path matches this glob.': 'Nur Dateien, deren Pfad relativ zum Stammverzeichnis diesem Glob entspricht.',
      'Only these comma-separated rules: unresolved-link, unresolved-embed, ambiguous-link, unresolved-anchor, invalid-frontmatter, invalid-canvas, invalid-base, property-type-mismatch, duplicate-block-id, empty-file, orphan-attachment.': 'Nur diese kommagetrennten Regeln: unresolved-link, unresolved-embed, ambiguous-link, unresolved-anchor, invalid-frontmatter, invalid-canvas, invalid-base, property-type-mismatch, duplicate-block-id, empty-file, orphan-attachment.',
      'Fail with VAULT_CHECK_FAILED when any finding has error severity.': 'Mit VAULT_CHECK_FAILED fehlschlagen, wenn ein Befund den Schweregrad error hat.',
      'Order by tag name or by file count, most used first.': 'Nach Tag-Name oder nach Dateianzahl sortieren, die häufigsten zuerst.',
      'Only this property, with the value type of each note.': 'Nur diese Eigenschaft, mit dem Werttyp jeder Notiz.',
      'Severity per rule id (error, warning, info or off), overriding the rule\'s default.': 'Schweregrad je Regel-ID (error, warning, info oder off), der den Standard der Regel überschreibt.',
      'Default error.': 'Standard: error.',
      'Default warning.': 'Standard: warning.',
      'Default info.': 'Standard: info.',
      'Path globs of files that vault check, tags and properties skip; they remain link targets.': 'Pfad-Globs von Dateien, die vault check, tags und properties überspringen; sie bleiben Linkziele.',
    },
  },
};
