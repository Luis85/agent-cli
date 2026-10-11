import { ensure, forgeError } from '../shared/errors.ts';
import type { CachedMetadata, ListItemCache } from '../metadata/cache.ts';
import { asLines, insertLines, lineBreak, lineStart, nextLine, type RangeEditMode } from './sections.ts';

/** SECTION_NOT_FOUND lists at most this many block ids. */
const reportedBlocks = 50;
/** A list item's marker with its trailing spaces, and the task checkbox that may follow it. */
const itemMarker = /^((?:[-*+]|\d{1,9}[.)])[ \t]+)((?:\[.\][ \t]+)?)/;
const blankLine = /^[ \t]*(?:\r?\n|$)/;

/** Lowercase `^id` occurrences on paragraphs, other sections and list items; Obsidian uses only the first. */
function blockCount(metadata: CachedMetadata, id: string): number {
  return [...metadata.sections ?? [], ...metadata.listItems ?? []].filter(item => item.id?.toLowerCase() === id).length;
}

/**
 * Inserts content as separate Markdown blocks at line start `at`: a blank line separates it from a nonblank line
 * before and after it, so it never joins the paragraph or section next to it.
 */
function insertBlocks(text: string, at: number, content: string, newline: string): string {
  let head = text.slice(0, at);
  const tail = text.slice(at);
  if (head !== '' && !head.endsWith('\n')) head += newline;
  if (head !== '' && !/(?:^|\n)[ \t]*\r?\n$/.test(head)) head += newline;
  return head + asLines(content, newline) + (tail !== '' && !blankLine.test(tail) ? newline : '') + tail;
}

/**
 * The end of a list item including its nested items: listItems run in document order, children after parents and
 * indented further (a top-level item on line 0 has parent -0, so the parent line alone cannot tell).
 */
function subtreeEnd(items: readonly ListItemCache[], item: ListItemCache): number {
  const lines = new Set([item.position.start.line]);
  let end = item.position.end.offset;
  for (const next of items.slice(items.indexOf(item) + 1)) {
    if (!lines.has(next.parent) || next.position.start.col <= item.position.start.col) break;
    lines.add(next.position.start.line);
    end = Math.max(end, next.position.end.offset);
  }
  return end;
}

/** `lines` with `first` before the first line and `indent` before the others; blank lines keep only its trimmed form. */
function indented(lines: readonly string[], first: string, indent: string, newline: string): string {
  return lines.map((line, index) => (index === 0 ? first + line : line.trim() === '' ? indent.trimEnd() + line : indent + line)).join(newline);
}

/**
 * Edits a list item named by its trailing `^id`. Its indentation (or quote prefix), list marker and checkbox stay:
 * `replace` swaps only the item's own text, keeping its nested items, unless the content starts with a list marker
 * of its own (such as `- [x] Done`), which then replaces the marker and checkbox too. `append` and `prepend` insert
 * sibling items at the item's indentation, after its nested items or before its line; the content must start with
 * a list marker, because other text would continue the item and move its `^id` away from the item's end.
 */
function editListItem(text: string, metadata: CachedMetadata, item: ListItemCache, id: string, mode: RangeEditMode, content: string, newline: string): string {
  const start = item.position.start.offset, lineAt = lineStart(text, start), prefix = text.slice(lineAt, start);
  const lines = content.replace(/\r?\n$/, '').split(/\r?\n/);
  if (mode !== 'replace') {
    ensure(itemMarker.test(lines[0]!), 'INVALID_INPUT', `Content added next to the list item ^${id} becomes sibling list items, so it must start with a list marker, such as "- ${lines[0]!.trim() || 'Item'}".`, { block: id });
    const siblings = lines.map(line => (line.trim() === '' ? prefix.trimEnd() : prefix + line)).join(newline);
    return insertLines(text, mode === 'append' ? nextLine(text, subtreeEnd(metadata.listItems ?? [], item)) : lineAt, siblings, newline);
  }
  const [, bullet = '', checkbox = ''] = itemMarker.exec(text.slice(start)) ?? [];
  const own = itemMarker.exec(lines[0]!);
  const first = own ? '' : bullet + checkbox;
  const width = (own?.[1] ?? bullet).length;
  let replacement = indented(lines, first, prefix.replace(/[^\s>]/g, ' ') + ' '.repeat(width), newline);
  if (!new RegExp(`(?:^|\\s)\\^${id}\\s*$`, 'i').test(replacement)) replacement += ` ^${id}`;
  return text.slice(0, start) + replacement + text.slice(item.position.end.offset);
}

/**
 * Edits the block that `^id` names, so that the id keeps naming it. A paragraph ending with the marker, or a table,
 * list, quote or other section before a line holding only the marker: `replace` swaps the block's text and keeps
 * its marker; `append` adds content after the block (after a marker line that follows it) and `prepend` before it,
 * both separated by blank lines so the content stays its own block. List items follow `editListItem`.
 */
export function editBlock(text: string, metadata: CachedMetadata, id: string, mode: RangeEditMode, content: string): string {
  const key = id.replace(/^\^/, '').toLowerCase(), block = metadata.blocks?.[key];
  if (!block) throw forgeError('SECTION_NOT_FOUND', `No block has the id ^${key}.`, { block: key, blocks: Object.values(metadata.blocks ?? {}).sort((a, b) => a.position.start.offset - b.position.start.offset).slice(0, reportedBlocks).map(item => item.id) });
  const count = blockCount(metadata, key);
  ensure(count <= 1, 'AMBIGUOUS_SECTION', `The block id ^${block.id} occurs ${count} times; Obsidian links only the first. Give each block a unique id.`, { block: block.id, matches: count });
  const newline = lineBreak(text), { start, end } = { start: block.position.start.offset, end: block.position.end.offset };
  const item = metadata.listItems?.find(candidate => candidate.id?.toLowerCase() === key && candidate.position.start.offset === start);
  if (item) return editListItem(text, metadata, item, block.id, mode, content, newline);
  // Block ids are letters, digits and dashes, so they need no escaping in a pattern.
  const marker = new RegExp(`(?:^|\\s)\\^${block.id}\\s*$`, 'i');
  const inside = marker.test(text.slice(start, end));
  if (mode === 'prepend') return insertBlocks(text, lineStart(text, start), content, newline);
  if (mode === 'append') {
    const markerLine = inside ? null : new RegExp(`^\\s*\\^${block.id}[ \\t]*(?=\\r?\\n|$)`, 'i').exec(text.slice(end));
    return insertBlocks(text, nextLine(text, end + (markerLine?.[0].length ?? 0)), content, newline);
  }
  const replacement = asLines(content, newline).replace(/\r?\n$/, '');
  const kept = inside && !marker.test(replacement) ? `${replacement} ^${block.id}` : replacement;
  return text.slice(0, start) + kept + text.slice(end);
}
