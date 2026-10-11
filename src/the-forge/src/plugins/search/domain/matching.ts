import { maxPatternLength, searchError, type SearchKind, type SearchQuery, type SearchScope } from './query.ts';

/** A match on one line: zero-based line index and UTF-16 column, and the matched text. */
export interface LineHit { line: number; column: number; match: string }

const syntax = /[.*+?^${}()|[\]\\/]/g;
/** Lines longer than `maxLineText` are clipped: a snippet keeps `snippetRadius` characters around its match. */
const snippetRadius = 80;
const maxLineText = 200;

/**
 * The expression for a query: the escaped literal, or the pattern as a JavaScript regular expression with the
 * `u` flag; case-insensitive unless `caseSensitive`. Empty, overlong and invalid patterns are INVALID_SEARCH_PATTERN.
 */
export function searchExpression(query: Pick<SearchQuery, 'pattern' | 'regex' | 'caseSensitive'>): RegExp {
  if (query.pattern.length === 0 || query.pattern.length > maxPatternLength) {
    throw searchError('INVALID_SEARCH_PATTERN', `The pattern must have 1 to ${maxPatternLength} characters.`);
  }
  const source = query.regex ? query.pattern : query.pattern.replace(syntax, '\\$&');
  try { return new RegExp(source, `gu${query.caseSensitive ? '' : 'i'}`); }
  catch (error) { throw searchError('INVALID_SEARCH_PATTERN', `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Lines split at `\r\n`, `\n` and `\r`, like the metadata cache's line numbers. */
export const splitLines = (text: string) => text.split(/\r\n|\n|\r/);

/** The zero-based delimiter lines of leading `---` frontmatter, or undefined when the file has none. */
export function frontmatterRange(lines: readonly string[]): { start: number; end: number } | undefined {
  if (lines.length < 2 || lines[0]!.trimEnd() !== '---') return undefined;
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
  return end < 0 ? undefined : { start: 0, end };
}

/**
 * Which lines a scope reads. Markdown frontmatter is the content between its delimiters; the body is everything
 * after the closing delimiter (the whole file without frontmatter). Other kinds have no frontmatter. `skipped`
 * lines (fenced or indented code) are never read.
 */
export function searchedLines(lines: readonly string[], kind: SearchKind, scope: SearchScope, skipped: ReadonlySet<number> = new Set()): (line: number) => boolean {
  const range = kind === 'markdown' ? frontmatterRange(lines) : undefined;
  const inFrontmatter = (line: number) => range !== undefined && line > range.start && line < range.end;
  const inBody = (line: number) => range === undefined || line > range.end;
  const scoped = scope === 'all' ? () => true : scope === 'frontmatter' ? inFrontmatter : inBody;
  return line => scoped(line) && !skipped.has(line);
}

/** Every nonempty match of a global expression on the included lines, in line and column order. */
export function matchLines(expression: RegExp, lines: readonly string[], included: (line: number) => boolean): LineHit[] {
  const hits: LineHit[] = [];
  for (const [line, text] of lines.entries()) {
    if (!included(line)) continue;
    expression.lastIndex = 0;
    for (let found = expression.exec(text); found; found = expression.exec(text)) {
      if (found[0].length === 0) { expression.lastIndex = found.index + (text.codePointAt(found.index)! > 0xffff ? 2 : 1); continue; }
      hits.push({ line, column: found.index, match: found[0] });
    }
  }
  return hits;
}

/** A line clipped to `radius` characters around `[start, end)`, marking removed text with an ellipsis. */
export function clipAround(text: string, start: number, end: number, radius = snippetRadius): string {
  if (text.length <= maxLineText) return text;
  const from = Math.max(0, start - radius), to = Math.min(text.length, Math.max(end, start) + radius);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

/** A context line clipped to its first characters. */
export const clipLine = (text: string) => text.length <= maxLineText ? text : `${text.slice(0, maxLineText)}…`;
