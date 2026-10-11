import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

/** The search plugin's German manifest and option, argument and settings descriptions, available while it is disabled. */
export const searchStrings: PluginStrings = {
  de: {
    manifest: { name: 'Suche', description: 'Textdateien nach wörtlichen Mustern oder regulären Ausdrücken durchsuchen, mit Metadatenfiltern und seitenweiser Ausgabe.' },
    descriptions: {
      'Treat the pattern as a JavaScript regular expression (u flag).': 'Das Muster als regulären JavaScript-Ausdruck behandeln (u-Flag).',
      'Match case exactly; matching ignores case by default.': 'Groß- und Kleinschreibung exakt beachten; standardmäßig wird sie ignoriert.',
      'Markdown lines to read: the body after frontmatter, the frontmatter, or both.': 'Zu lesende Markdown-Zeilen: der Inhalt nach dem Frontmatter, das Frontmatter oder beides.',
      'Skip fenced and indented code blocks in Markdown.': 'Umzäunte und eingerückte Codeblöcke in Markdown überspringen.',
      'Only files of this text kind.': 'Nur Dateien dieser Textart.',
      'Only files whose root-relative path matches this glob.': 'Nur Dateien, deren Pfad relativ zum Stammverzeichnis diesem Glob entspricht.',
      'Only notes with this tag or a nested tag below it.': 'Nur Notizen mit diesem Tag oder einem darunter verschachtelten Tag.',
      'Only notes whose frontmatter has key (not null), or key=value.': 'Nur Notizen, deren Frontmatter key (nicht null) oder key=value enthält.',
      'Lines of context before and after each hit (0–50).': 'Kontextzeilen vor und nach jedem Treffer (0–50).',
      'Maximum hits per page; a truncated page returns nextCursor.': 'Höchstzahl der Treffer je Seite; eine gekürzte Seite liefert nextCursor.',
      'Continue after the page that returned this nextCursor, with the same pattern and filters.': 'Nach der Seite fortfahren, die diesen nextCursor geliefert hat, mit demselben Muster und denselben Filtern.',
      'Literal text, or a JavaScript regular expression with --regex. Use -- before a pattern that starts with -.': 'Wörtlicher Text oder mit --regex ein regulärer JavaScript-Ausdruck. Setzen Sie -- vor ein Muster, das mit - beginnt.',
      'Milliseconds one search may spend matching before it fails with SEARCH_TIMEOUT.': 'Millisekunden, die eine Suche für den Abgleich aufwenden darf, bevor sie mit SEARCH_TIMEOUT fehlschlägt.',
    },
  },
};
