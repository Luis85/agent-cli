import type { Language } from '../../../application/plugins/plugin-catalog.ts';
import { retranslate } from '../../../domain/shared/messages.ts';
import { indexMessages, type IndexMessage } from '../application/messages.ts';

/** German Bases index warnings; `{problem}` keeps the parser's original message. */
const germanIndexMessages: Record<IndexMessage, string> = {
  ambiguousLink: 'Der Link {link} in {source} passt auf {candidates}; er wird zur nächstgelegenen Datei {resolved} aufgelöst.',
  unparseableNote: '{path} kann nicht geparst werden und wird ohne Eigenschaften, Links und Tags indexiert: {problem}',
};

/** A query result whose index warnings read in the response language, for `bases query` and the `bases.query` service. */
export function localizedQuery<T extends { warnings: ReadonlyArray<{ message: string }> }>(result: T, language: Language): T {
  if (language === 'en') return result;
  return { ...result, warnings: result.warnings.map(warning => ({ ...warning, message: retranslate(warning.message, indexMessages, germanIndexMessages) })) };
}
