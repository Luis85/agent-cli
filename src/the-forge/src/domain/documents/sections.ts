import { ensure, forgeError } from '../shared/errors.ts';
import type { CachedMetadata, HeadingCache } from '../metadata/cache.ts';

/** How a section or block edit places `content`: instead of the existing text, after it or before it. */
export type RangeEditMode = 'replace' | 'append' | 'prepend';
export const rangeEditModes: readonly RangeEditMode[] = ['replace', 'append', 'prepend'];
/** SECTION_NOT_FOUND and AMBIGUOUS_SECTION list at most this many headings or candidates. */
const reportedHeadings = 50;

interface Section { heading: HeadingCache; path: string[]; bodyStart: number; end: number }

/** The file's line terminator, from its first line break; LF when it has none. */
function lineBreak(text: string): string {
  return /\r?\n/.exec(text)?.[0] ?? '\n';
}

/** Offset just after the line that contains `offset` (after its terminator), or the text length on the last line. */
function nextLine(text: string, offset: number): number {
  const index = text.indexOf('\n', offset);
  return index < 0 ? text.length : index + 1;
}

/** Root headings with their heading path (outermost first) and the section each one spans. */
function sections(text: string, headings: readonly HeadingCache[]): Section[] {
  const ordered = [...headings].sort((a, b) => a.position.start.offset - b.position.start.offset);
  const stack: HeadingCache[] = [];
  return ordered.map((heading, index) => {
    while (stack.length > 0 && stack.at(-1)!.level >= heading.level) stack.pop();
    stack.push(heading);
    const next = ordered.slice(index + 1).find(candidate => candidate.level <= heading.level);
    return { heading, path: stack.map(item => item.heading.trim()), bodyStart: nextLine(text, heading.position.end.offset), end: next?.position.start.offset ?? text.length };
  });
}

/** Whether `segments` name `path`: the last segment is the heading itself, the others its ancestors in order. */
function names(path: readonly string[], segments: readonly string[], same: (a: string, b: string) => boolean): boolean {
  if (!same(path.at(-1)!, segments.at(-1)!)) return false;
  let next = 0;
  for (const ancestor of path.slice(0, -1)) if (next < segments.length - 1 && same(ancestor, segments[next]!)) next++;
  return next === segments.length - 1;
}

const exact = (a: string, b: string) => a === b;
const caseless = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const describe = (section: Section) => ({ section: section.path.join(' > '), line: section.heading.position.start.line + 1 });

/**
 * The section a heading path names, such as `Plan > Risks`: segments are separated by ` > `, the last one is the
 * heading and the others are ancestor headings in order, not necessarily direct parents. Headings match their
 * text exactly, or ignoring letter case when no heading matches exactly. A section runs from its heading to the
 * next heading of the same or a higher level.
 */
function findSection(text: string, headings: readonly HeadingCache[], heading: string): Section {
  const segments = heading.split(/\s>\s/).map(segment => segment.trim());
  ensure(segments.every(segment => segment.length > 0), 'INVALID_INPUT', 'A section path lists heading texts separated by " > ", such as "Plan > Risks".');
  const all = sections(text, headings);
  let matches = all.filter(section => names(section.path, segments, exact));
  if (matches.length === 0) matches = all.filter(section => names(section.path, segments, caseless));
  if (matches.length === 0) {
    throw forgeError('SECTION_NOT_FOUND', `No heading matches the section path "${heading}".`, { section: heading, headings: all.slice(0, reportedHeadings).map(describe) });
  }
  ensure(matches.length === 1, 'AMBIGUOUS_SECTION', `The section path "${heading}" matches ${matches.length} headings; add an ancestor heading, such as "Parent > ${segments.at(-1)}".`,
    { section: heading, matches: matches.length, candidates: matches.slice(0, reportedHeadings).map(describe) });
  return matches[0]!;
}

/** Content as whole lines: a nonempty text gains a final line break when it lacks one. */
function asLines(content: string, newline: string): string {
  return content === '' || content.endsWith('\n') ? content : content + newline;
}

/** Inserts whole lines at a line start, first ending an unterminated last line. */
function insertLines(text: string, at: number, content: string, newline: string): string {
  const lead = at > 0 && text[at - 1] !== '\n' ? newline : '';
  return text.slice(0, at) + lead + asLines(content, newline) + text.slice(at);
}

/**
 * Edits the section body under a heading. The heading line stays. Its content is the text after the blank lines
 * that follow the heading and before the blank lines that precede the next heading: `replace` swaps it, `append`
 * adds lines after it and `prepend` before it, keeping those blank lines. Content is inserted as whole lines.
 */
export function editSection(text: string, metadata: CachedMetadata, heading: string, mode: RangeEditMode, content: string): string {
  const section = findSection(text, metadata.headings ?? [], heading), newline = lineBreak(text);
  const body = text.slice(section.bodyStart, section.end);
  const start = section.bodyStart + (/^(?:[ \t]*\r?\n)*/.exec(body)?.[0].length ?? 0);
  const last = text.slice(start, section.end).trimEnd().length;
  const end = last === 0 ? start : Math.min(nextLine(text, start + last - 1), section.end);
  if (mode === 'prepend') return insertLines(text, start, content, newline);
  if (mode === 'append') return insertLines(text, end, content, newline);
  const lead = start > 0 && text[start - 1] !== '\n' ? newline : '';
  return text.slice(0, start) + lead + asLines(content, newline) + text.slice(end);
}

/** Lowercase `^id` occurrences on paragraphs, other sections and list items; Obsidian uses only the first. */
function blockCount(metadata: CachedMetadata, id: string): number {
  return [...metadata.sections ?? [], ...metadata.listItems ?? []].filter(item => item.id?.toLowerCase() === id).length;
}

/**
 * Edits the block that `^id` names: a paragraph or list item ending with the marker, or the section before a line
 * holding only the marker. `replace` swaps the block's text and keeps its marker, `append` adds lines after the
 * block (and after a marker line that follows it) and `prepend` adds lines before the block's first line.
 */
export function editBlock(text: string, metadata: CachedMetadata, id: string, mode: RangeEditMode, content: string): string {
  const key = id.replace(/^\^/, '').toLowerCase(), block = metadata.blocks?.[key];
  if (!block) throw forgeError('SECTION_NOT_FOUND', `No block has the id ^${key}.`, { block: key, blocks: Object.values(metadata.blocks ?? {}).sort((a, b) => a.position.start.offset - b.position.start.offset).slice(0, reportedHeadings).map(item => item.id) });
  const count = blockCount(metadata, key);
  ensure(count <= 1, 'AMBIGUOUS_SECTION', `The block id ^${block.id} occurs ${count} times; Obsidian links only the first. Give each block a unique id.`, { block: block.id, matches: count });
  const newline = lineBreak(text), { start, end } = { start: block.position.start.offset, end: block.position.end.offset };
  // Block ids are letters, digits and dashes, so they need no escaping in a pattern.
  const marker = new RegExp(`(?:^|\\s)\\^${block.id}\\s*$`, 'i');
  const inside = marker.test(text.slice(start, end));
  if (mode === 'prepend') return insertLines(text, text.lastIndexOf('\n', start - 1) + 1, content, newline);
  if (mode === 'append') {
    const markerLine = inside ? null : new RegExp(`^\\s*\\^${block.id}[ \\t]*(?=\\r?\\n|$)`, 'i').exec(text.slice(end));
    return insertLines(text, nextLine(text, end + (markerLine?.[0].length ?? 0)), content, newline);
  }
  const replacement = content.replace(/\r?\n$/, '');
  const kept = inside && !marker.test(replacement) ? `${replacement} ^${block.id}` : replacement;
  return text.slice(0, start) + kept + text.slice(end);
}
