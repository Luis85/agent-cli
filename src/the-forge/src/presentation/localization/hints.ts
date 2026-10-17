import { isRecord } from '../../domain/shared/errors.ts';
import { copyCommands, forceOptions } from '../../application/plugins/suggestions.ts';
import type { Language } from '../../application/plugins/plugin-catalog.ts';

/** The codes whose `details.suggestions` are did-you-mean suggestions for an unknown command, action or option. */
const suggestionCodes = new Set(['UNKNOWN_COMMAND', 'UNKNOWN_OPTION', 'UNKNOWN_GENERATOR', 'INVALID_ARGUMENT']);

const phrases = {
  en: {
    suggest: (items: string) => `Did you mean ${items}?`, or: ' or ',
    force: 'There is no force option: pass --if-match <revision> with the file\'s current revision from read or stat.',
    copy: 'There is no copy command: read the source, then create the copy with its content.',
  },
  de: {
    suggest: (items: string) => `Meinten Sie ${items}?`, or: ' oder ',
    force: 'Es gibt keine Force-Option: Übergeben Sie --if-match <revision> mit der aktuellen Revision der Datei aus read oder stat.',
    copy: 'Es gibt keinen Kopierbefehl: Lesen Sie die Quelle mit read und legen Sie die Kopie mit create und deren Inhalt an.',
  },
} satisfies Record<Language, unknown>;

/** `a`, `a or b`, `a, b or c`. */
function alternatives(items: readonly string[], or: string): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')}${or}${items.at(-1)!}`;
}

/** The suggestion sentence of a failure: an explanation for a force option or copy command, else did-you-mean. */
function suggestion(code: string, details: Record<string, unknown>, language: Language): string | undefined {
  const suggestions = Array.isArray(details.suggestions) ? details.suggestions.filter((item): item is string => typeof item === 'string') : [];
  if (!suggestionCodes.has(code) || suggestions.length === 0) return undefined;
  const text = phrases[language];
  if (code === 'UNKNOWN_OPTION' && forceOptions.includes(String(details.option)) && suggestions.includes('--if-match')) return text.force;
  if (code === 'UNKNOWN_COMMAND' && copyCommands.includes(String(details.command))) return text.copy;
  return text.suggest(alternatives(suggestions, text.or));
}

/**
 * The hint of one failure: the catalog hint with `help <command>` naming the invoked command (or the command in
 * `details.command`), after a sentence for its did-you-mean `details.suggestions`, in the response language.
 */
export function guidedHint(hint: string, code: string, details: Record<string, unknown> | undefined, language: Language, command?: string): string {
  const named = command ?? (code !== 'UNKNOWN_COMMAND' && typeof details?.command === 'string' ? details.command : undefined);
  const next = named === undefined ? hint : hint.replaceAll('help <command>', `help ${named}`);
  const first = isRecord(details) ? suggestion(code, details, language) : undefined;
  return first === undefined ? next : `${first} ${next}`;
}
