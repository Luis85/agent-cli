import { AppError, ensure, forgeError, locatedError } from '../shared/errors.ts';

/** AMBIGUOUS_EDIT reports at most this many match lines; `matches` always carries the full count. */
export const reportedMatchLines = 20;
/** Snippets of matching or similar lines are cut to this many characters. */
const snippetLength = 80;

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

/** The text of the 1-based `line`, without its line ending, cut to `snippetLength` characters. */
function snippet(lines: readonly string[], line: number): { line: number; text: string } {
  const text = lines[line - 1]!.replace(/\r$/, '');
  return { line, text: text.length > snippetLength ? `${text.slice(0, snippetLength - 1)}…` : text };
}

/** Which line endings `text` uses: `none` when it has a single line. */
function lineEndings(text: string): 'crlf' | 'lf' | 'mixed' | 'none' {
  const crlf = text.split('\r\n').length - 1, lf = text.split('\n').length - 1 - crlf;
  return crlf > 0 && lf > 0 ? 'mixed' : crlf > 0 ? 'crlf' : lf > 0 ? 'lf' : 'none';
}

const loose = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * NO_MATCH with what helps to correct `find`: the file's line endings, and the first line that contains the first
 * nonblank line of `find` when whitespace and letter case are ignored.
 */
function noMatch(text: string, find: string): AppError {
  const endings = lineEndings(text), needle = loose(find.split('\n').find(line => line.trim().length > 0) ?? '');
  const lines = text.split('\n'), near = needle.length === 0 ? -1 : lines.findIndex(line => loose(line).includes(needle));
  const crlf = find.includes('\n') && !find.includes('\r\n') && (endings === 'crlf' || endings === 'mixed');
  const message = `The find text does not occur in the file. Read it again and copy the exact current text.${crlf ? ' The file has CRLF line endings, but the find text has LF.' : ''}`;
  return forgeError('NO_MATCH', message, { find, matches: 0, lineEndings: endings, ...(near < 0 ? {} : { nearMatch: snippet(lines, near + 1) }) });
}

/** Replace the single literal occurrence of `find`; zero or several occurrences are distinct failures. */
export function replaceUniqueLiteral(text: string, find: string, replacement: string): string {
  ensure(find.length > 0, 'INVALID_INPUT', '--find must not be empty.');
  const matches = literalMatches(text, find);
  if (matches.length === 0) throw noMatch(text, find);
  if (matches.length > 1) {
    const lines = lineNumbers(text, matches.slice(0, reportedMatchLines)), all = text.split('\n');
    throw forgeError('AMBIGUOUS_EDIT', `The find text matches ${matches.length} times, including overlapping matches; it must match exactly once.`,
      { matches: matches.length, lines, snippets: [...new Set(lines)].map(line => snippet(all, line)) });
  }
  const [offset] = matches as [number];
  return text.slice(0, offset) + replacement + text.slice(offset + find.length);
}

/** One literal replacement of a multi-edit: `find` must occur exactly once, or at least once with `all`. */
export interface LiteralEdit { find: string; replace: string; all?: boolean }

/** Replaces every non-overlapping occurrence of `find`, scanning left to right; none is NO_MATCH. */
function replaceEveryLiteral(text: string, find: string, replacement: string): string {
  ensure(find.length > 0, 'INVALID_INPUT', 'find must not be empty.');
  const parts = text.split(find);
  if (parts.length === 1) throw noMatch(text, find);
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
