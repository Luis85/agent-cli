import { addDays, daysBetween, formatCivil, setOwn, type CivilDate, type Frontmatter } from './fields.ts';
import { normalizePath, vaultFolder } from './settings-resolve.ts';
import { optionalKeyFor, type BacklogSettings } from './settings.ts';
import type { ReleaseSettings } from './settings-resolve.ts';
import { ITERATION_TYPE, RELEASE_TYPE, isIterationType, isReleaseType } from './vocabulary.ts';

/** The fixed id key; its value is the vault's highest numeric `pbl-id` plus one, written only at creation. */
export const ITEM_ID_KEY = 'pbl-id';

/** backlog-view's `sanitizeTitle`: characters a file name cannot hold become `-`; never empty. */
export function sanitizeTitle(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().replace(/^[-\s.]+|[-\s]+$/g, '');
  return cleaned.length > 0 ? cleaned : 'Untitled';
}

/** `<folder>/<sanitized title>.md`, then ` 1`, ` 2`… while the name is taken. */
export function uniqueNotePath(folder: string, title: string, taken: (path: string) => boolean): string {
  const base = sanitizeTitle(title);
  const filePath = (name: string) => (folder ? normalizePath(`${folder}/${name}.md`) : `${name}.md`);
  let path = filePath(base);
  for (let copy = 1; taken(path); copy++) path = filePath(`${base} ${copy}`);
  return path;
}

/** backlog-view's `nextItemId`: the highest numeric `pbl-id` (numbers and numeric strings) plus one. */
export function nextItemId(frontmatters: Iterable<Frontmatter | undefined>): number {
  let highest = 0;
  for (const frontmatter of frontmatters) {
    const raw = frontmatter !== undefined && Object.hasOwn(frontmatter, ITEM_ID_KEY) ? frontmatter[ITEM_ID_KEY] : undefined;
    if (typeof raw !== 'number' && typeof raw !== 'string') continue;
    const value = Math.floor(Number(raw));
    if (value > highest && value < Number.MAX_SAFE_INTEGER) highest = value;
  }
  return highest + 1;
}

/** What `createBacklogItem` receives; link targets are vault paths, already rendered as wikilinks. */
export interface NewItemSpec {
  id: number; typeName: string; order: number;
  parentLink: string | null; iterationLink?: string; releaseLink?: string; iterationGoal?: string;
  axis?: { horizon?: string; start?: string; target?: string };
}

/**
 * The frontmatter of a new item in backlog-view's key order: `pbl-id`, type, parent (or `''` in folder mode),
 * order, goal, iteration, release, then horizon, start and target. Releases are never seeded with a planning
 * link or axis.
 */
export function newItemFrontmatter(settings: BacklogSettings, spec: NewItemSpec): Frontmatter {
  const frontmatter: Frontmatter = {};
  setOwn(frontmatter, ITEM_ID_KEY, spec.id);
  setOwn(frontmatter, settings.typeKey, spec.typeName);
  if (spec.parentLink !== null) setOwn(frontmatter, settings.parentKey, spec.parentLink);
  else if (settings.folderHierarchy) setOwn(frontmatter, settings.parentKey, '');
  setOwn(frontmatter, settings.orderKey, spec.order);
  const seeded = !isReleaseType(spec.typeName);
  if (spec.iterationGoal && settings.iterationGoalKey) setOwn(frontmatter, settings.iterationGoalKey, spec.iterationGoal);
  if (seeded && spec.iterationLink && settings.iterationKey) setOwn(frontmatter, settings.iterationKey, spec.iterationLink);
  if (seeded && spec.releaseLink && settings.releaseKey) setOwn(frontmatter, settings.releaseKey, spec.releaseLink);
  if (seeded) {
    for (const field of ['horizon', 'start', 'target'] as const) {
      const key = optionalKeyFor(settings, field), value = spec.axis?.[field];
      if (key !== '' && value !== undefined) setOwn(frontmatter, key, value);
    }
  }
  return frontmatter;
}

/** `createRelease`: `pbl-id`, type, then version, target date, status and description when stated and bound. */
export function releaseFrontmatter(settings: ReleaseSettings, id: number, spec: { version?: string; targetDate?: string; status?: string; description?: string }): Frontmatter {
  const frontmatter: Frontmatter = {};
  setOwn(frontmatter, ITEM_ID_KEY, id);
  setOwn(frontmatter, settings.typeKey, RELEASE_TYPE);
  const stated = (value: string | undefined): value is string => value !== undefined && value.trim() !== '';
  for (const [value, key] of [[spec.version, settings.versionKey], [spec.targetDate, settings.targetDateKey], [spec.status, settings.statusKey], [spec.description, settings.descriptionKey]] as const) {
    if (stated(value) && key) setOwn(frontmatter, key, value);
  }
  return frontmatter;
}

/** A new note: frontmatter only, `---\n<yaml>---\n`. */
export const noteText = (yaml: string) => `---\n${yaml}---\n`;

const frontmatterEnd = (text: string) => {
  const opening = /^﻿?---[ \t]*\r?\n/.exec(text);
  const closing = opening ? /^---[ \t]*(\r?\n|$)/m.exec(text.slice(opening[0].length)) : null;
  return opening && closing ? opening[0].length + closing.index + closing[0].length : 0;
};

/** The text after a note's frontmatter, without the blank lines that separate it. */
export const noteBody = (text: string) => text.slice(frontmatterEnd(text)).replace(/^(\r?\n)+/, '');

/** The note with its body replaced; an empty body leaves only the frontmatter. */
export function withBody(text: string, body: string): string {
  const head = text.slice(0, frontmatterEnd(text));
  const trimmed = body.replace(/\r\n?/g, '\n').trim();
  return trimmed === '' ? head : `${head}${head === '' || head.endsWith('\n') ? '' : '\n'}${trimmed}\n`;
}

// Obsidian comments (https://obsidian.md/help/syntax, Comments). A `%%` outside code opens a comment that hides
// everything up to the next `%%`, blank lines, Markdown and fences included, or the rest of the note when it is never
// closed. A `%%` inside fenced code, or inside a code span that opened before it, is text, and so is an escaped `\%%`.
// When the Markdown is ambiguous, text counts as prose, so a comment is removed rather than pushed.

// Fenced code as CommonMark reads it inside list items, whose content Obsidian indents with tabs or spaces: a run of
// three or more backticks (whose info string holds no backtick) or tildes after any indentation, closed by a run of
// the same character at least as long, indented at most three columns past the opener, with only whitespace after
// it. A line indented more than three columns less than the opener leaves its list item, which ends the block.
const OPENING_FENCE = /^[ \t]*(`{3,}(?=[^`]*$)|~{3,})/;
const CLOSING_FENCE = /^[ \t]*(`{3,}|~{3,})\s*$/;

/** The columns a line's indentation takes, a tab reaching the next multiple of four. */
function indentation(line: string): number {
  let width = 0;
  for (const char of /^[ \t]*/.exec(line)![0]) width = char === '\t' ? (Math.floor(width / 4) + 1) * 4 : width + 1;
  return width;
}

/** Where fenced code opening on the line at `start` ends (after its closing line), or `start` when none opens there. */
function fenceEnd(body: string, start: number): number {
  const lineAt = (at: number) => body.slice(at, body.indexOf('\n', at) + 1 || body.length);
  const first = lineAt(start), opener = OPENING_FENCE.exec(first)?.[1];
  if (opener === undefined) return start;
  const indent = indentation(first);
  let at = start + first.length;
  while (at < body.length) {
    const line = lineAt(at);
    if (line.trim() !== '' && indentation(line) < indent - 3) return at;
    at += line.length;
    const closer = CLOSING_FENCE.exec(line)?.[1];
    if (closer !== undefined && closer[0] === opener[0] && closer.length >= opener.length && indentation(line) <= indent + 3) return at;
  }
  return at;
}

// A paragraph, and so a code span, ends before a blank line or a line that starts another block: a heading, quote,
// table row, list item, fence, thematic break or setext underline.
const BLOCK_START = /\n(?=[ \t]*(?:[\r\n]|[#>|]|`{3}|~{3}|(?:[-*+]|\d+[.)])[ \t\r\n]|([-*_=])(?:[ \t]*\1)*[ \t]*[\r\n]))/g;

/** Where the code span opening with the backtick run at `start` ends, or the end of that run when it opens none. */
function codeSpanEnd(body: string, start: number): number {
  const run = /`+/y;
  run.lastIndex = start;
  const opener = run.exec(body)![0], from = start + opener.length;
  BLOCK_START.lastIndex = from;
  const paragraph = body.slice(from, BLOCK_START.exec(body)?.index);
  const closer = new RegExp(`(?<!\`)${opener}(?!\`)`).exec(paragraph);
  return closer === null ? from : from + closer.index + opener.length;
}

/** Where the comment whose text starts at `from` ends: after the next unescaped `%%`, or at the end of the body. */
function commentEnd(body: string, from: number): number {
  const marker = /\\(?:%%|[\s\S])|%%/g;
  marker.lastIndex = from;
  for (let found = marker.exec(body); found !== null; found = marker.exec(body)) if (found[0] === '%%') return marker.lastIndex;
  return body.length;
}

/** The `[start, end)` offsets of a body's Obsidian comments, in order. */
function commentSpans(body: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (let index = 0; index < body.length;) {
    const fenced = index === 0 || body[index - 1] === '\n' ? fenceEnd(body, index) : index;
    if (fenced > index) index = fenced;
    else if (body[index] === '\\') index += body.startsWith('%%', index + 1) ? 3 : 2;
    else if (body[index] === '`') index = codeSpanEnd(body, index);
    else if (body.startsWith('%%', index)) { const end = commentEnd(body, index + 2); spans.push([index, end]); index = end; }
    else index++;
  }
  return spans;
}

/** The body without its Obsidian `%%comments%%`; fenced and inline code are kept as they are. */
export function withoutComments(body: string): string {
  let visible = '', cursor = 0;
  for (const [start, end] of commentSpans(body)) { visible += body.slice(cursor, start); cursor = end; }
  return visible + body.slice(cursor);
}

/** The Obsidian `%%comments%%` of a body, in order: exactly the text `withoutComments` removes. */
export const comments = (body: string) => commentSpans(body).map(([start, end]) => body.slice(start, end));

// Iterations: `<N> - Iteration[ - <goal>]`, starting the day after the latest iteration's target.
interface IterationLike { title: string; typeName: string | null; outsideFilter: boolean; path: string; plannedStart: { value: CivilDate | null }; plannedTarget: { value: CivilDate | null } }

export function nextIterationName(items: Iterable<IterationLike>): string {
  let highest = 0;
  for (const item of items) {
    if (!isIterationType(item.typeName) || item.outsideFilter) continue;
    const found = /^\s*(\d+)/.exec(item.title);
    if (found && Number(found[1]) > highest) highest = Number(found[1]);
  }
  return `${highest + 1} - ${ITERATION_TYPE}`;
}

export function iterationNoteName(name: string, goal: string): string {
  const tail = goal.trim().slice(0, 60);
  return tail === '' ? name : `${name} - ${tail}`;
}

/** The iteration with the latest target (then latest start, then path). */
export function previousIteration<T extends IterationLike>(items: Iterable<T>): T | null {
  let best: T | null = null;
  for (const item of items) {
    const target = item.plannedTarget.value;
    if (!isIterationType(item.typeName) || target === null) continue;
    if (best === null) { best = item; continue; }
    const byTarget = daysBetween(best.plannedTarget.value!, target);
    const start = item.plannedStart.value, bestStart = best.plannedStart.value;
    // A dated start is later than a missing one; two missing starts tie and fall through to the path.
    const byStart = start === null || bestStart === null ? Number(start !== null) - Number(bestStart !== null) : daysBetween(bestStart, start);
    const later = byTarget !== 0 ? byTarget > 0 : byStart !== 0 ? byStart > 0 : item.path > best.path;
    if (later) best = item;
  }
  return best;
}

export function nextIterationDates(previous: IterationLike | null, today: CivilDate, lengthDays: number): { start: string; target: string } {
  const after = previous?.plannedTarget.value ?? null;
  const start = after === null ? today : addDays(after, 1);
  return { start: formatCivil(start), target: formatCivil(addDays(start, lengthDays - 1)) };
}

/** backlog-view's "Create backlog" scaffold for a folder. */
export function baseFileContent(folder: string): string {
  const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const formulaArg = folder.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return ['filters:', '  and:', `    - ${quote(`file.inFolder("${formulaArg}")`)}`, '    - file.ext == "md"', 'views:', '  - type: product-backlog', '    name: Backlog', `    homeFolder: ${quote(folder)}`, ''].join('\n');
}

/** `<folder>/Product Backlog.base`, then ` 1`, ` 2`… on collision; the folder defaults to `docs`. */
export function basePath(folderInput: string, taken: (path: string) => boolean): { folder: string; path: string } {
  const folder = vaultFolder(folderInput) || 'docs';
  let path = normalizePath(`${folder}/Product Backlog.base`);
  for (let copy = 1; taken(path); copy++) path = normalizePath(`${folder}/Product Backlog ${copy}.base`);
  return { folder, path };
}
