import { ensure } from '../shared/errors.ts';

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
