import { AppError, ensure, locatedError } from '../shared/errors.ts';

/** AMBIGUOUS_EDIT reports at most this many match lines; `matches` always carries the full count. */
export const reportedMatchLines = 20;

/** Start offsets of every literal occurrence, including overlapping occurrences. */
export function literalMatches(text: string, find: string): number[] {
  const offsets: number[] = [];
  if (find.length === 0) return offsets;
  for (let offset = text.indexOf(find); offset >= 0; offset = text.indexOf(find, offset + 1)) offsets.push(offset);
  return offsets;
}

/** 1-based line numbers of ascending offsets; CRLF and LF both end a line at the line feed. */
function lineNumbers(text: string, offsets: readonly number[]): number[] {
  const lines: number[] = [];
  let line = 1, scanned = 0;
  for (const offset of offsets) {
    for (let index = text.indexOf('\n', scanned); index >= 0 && index < offset; index = text.indexOf('\n', index + 1)) line++;
    scanned = offset;
    lines.push(line);
  }
  return lines;
}

/** Replace the single literal occurrence of `find`; zero or several occurrences are distinct failures. */
export function replaceUniqueLiteral(text: string, find: string, replacement: string): string {
  ensure(find.length > 0, 'INVALID_INPUT', '--find must not be empty.');
  const matches = literalMatches(text, find);
  ensure(matches.length > 0, 'NO_MATCH', 'The find text does not occur in the file. Read it again and copy the exact current text.', { find, matches: 0 });
  ensure(matches.length === 1, 'AMBIGUOUS_EDIT', `The find text matches ${matches.length} times, including overlapping matches; it must match exactly once.`,
    { matches: matches.length, lines: lineNumbers(text, matches.slice(0, reportedMatchLines)) });
  const [offset] = matches as [number];
  return text.slice(0, offset) + replacement + text.slice(offset + find.length);
}

/** One literal replacement of a multi-edit: `find` must occur exactly once, or at least once with `all`. */
export interface LiteralEdit { find: string; replace: string; all?: boolean }

/** Replaces every non-overlapping occurrence of `find`, scanning left to right; none is NO_MATCH. */
function replaceEveryLiteral(text: string, find: string, replacement: string): string {
  ensure(find.length > 0, 'INVALID_INPUT', 'find must not be empty.');
  const parts = text.split(find);
  ensure(parts.length > 1, 'NO_MATCH', 'The find text does not occur in the file. Read it again and copy the exact current text.', { find, matches: 0 });
  return parts.join(replacement);
}

/**
 * Applies literal edits in order, each to the result of the previous one, entirely in memory. A failing edit
 * keeps its code (NO_MATCH, AMBIGUOUS_EDIT, INVALID_INPUT) and names its 0-based position in `details.edit`.
 */
export function applyLiteralEdits(text: string, edits: readonly LiteralEdit[]): string {
  ensure(edits.length > 0, 'INVALID_INPUT', 'Pass at least one edit.');
  return edits.reduce((current, edit, index) => {
    try { return edit.all === true ? replaceEveryLiteral(current, edit.find, edit.replace) : replaceUniqueLiteral(current, edit.find, edit.replace); }
    catch (error) {
      if (!(error instanceof AppError)) throw error;
      throw locatedError(error, `Edit ${index}: `, { edit: index });
    }
  }, text);
}
