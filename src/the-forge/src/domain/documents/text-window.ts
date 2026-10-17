import { ensure } from '../shared/errors.ts';

/** A 1-based, inclusive line range; `end` undefined reads to the last line. */
export interface LineRange { start: number; end?: number }
/** The lines `content` holds: 1-based and inclusive, out of the `total` lines of the text. */
export interface LineWindow { start: number; end: number; total: number }
/**
 * A window of a text: the selected lines up to a byte limit, whether the limit cut it, its UTF-8 byte count, and
 * `partial` when its last line is only a prefix (a single line longer than the limit).
 */
export interface TextWindow { content: string; truncated: boolean; partial: boolean; bytes: number; lines: LineWindow }

const encoder = new TextEncoder();
const utf8Bytes = (text: string) => encoder.encode(text).length;

/** `--lines` as `start-end`, `start-` (to the last line) or `start`, with 1-based inclusive line numbers. */
export function lineRange(text: string): LineRange {
  const match = /^(\d+)(?:(-)(\d*))?$/.exec(text);
  const start = match ? Number(match[1]) : 0, end = match?.[3] ? Number(match[3]) : undefined;
  ensure(match !== null && Number.isSafeInteger(start) && start >= 1 && (end === undefined || (Number.isSafeInteger(end) && end >= start)), 'INVALID_ARGUMENT', '--lines must be start-end, start- or start, with 1-based line numbers and end at least start.');
  return match![2] === undefined ? { start, end: start } : { start, ...(end === undefined ? {} : { end }) };
}

/** The lines of a text with their terminators (\r\n, \n or \r), so the lines join back to the text. */
const textLines = (text: string): string[] => text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];

/** The longest prefix of `text` of at most `maxBytes` UTF-8 bytes that ends on a character boundary. */
function bytePrefix(text: string, maxBytes: number): string {
  let bytes = 0, end = 0;
  for (const char of text) {
    const size = utf8Bytes(char);
    if (bytes + size > maxBytes) break;
    bytes += size; end += char.length;
  }
  return text.slice(0, end);
}

/**
 * The lines of `range` (the whole text by default) up to `maxBytes` UTF-8 bytes: whole lines while they fit, and
 * when even the first selected line does not fit, its prefix up to the limit. A range starting after the last line
 * is INVALID_ARGUMENT, except line 1 of an empty text.
 */
export function textWindow(text: string, maxBytes: number, range: LineRange = { start: 1 }): TextWindow {
  const lines = textLines(text), total = lines.length;
  ensure(range.start <= Math.max(total, 1), 'INVALID_ARGUMENT', `--lines starts after the last line; the text has ${total} line${total === 1 ? '' : 's'}.`, { total });
  const last = Math.min(range.end ?? total, total);
  let content = '', bytes = 0, end = range.start - 1;
  for (let line = range.start; line <= last; line++) {
    const size = utf8Bytes(lines[line - 1]!);
    if (bytes + size > maxBytes) {
      const partial = line === range.start;
      if (partial) { content = bytePrefix(lines[line - 1]!, maxBytes); bytes = utf8Bytes(content); end = line; }
      return { content, truncated: true, partial, bytes, lines: { start: range.start, end, total } };
    }
    content += lines[line - 1]!; bytes += size; end = line;
  }
  return { content, truncated: false, partial: false, bytes, lines: { start: range.start, end, total } };
}
