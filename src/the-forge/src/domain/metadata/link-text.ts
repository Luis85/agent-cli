import { parseLinktext } from './cache.ts';
import { fileToLinktext, joinPath, type LinkIndex } from './link-resolution.ts';

/**
 * Link text for moved files. Each function rewrites only the path of one reference and keeps everything else of
 * its source text: the embed `!`, `#Heading` and `#^block` subpaths, `|display` text, titles, angle brackets,
 * percent-encoding, a leading `/` or `./`, and whether a Markdown target spells its `.md` extension.
 */

/** A replacement of `[start, end)` in a text; `original` is the replaced text, checked before applying. */
export interface TextEdit { start: number; end: number; original: string; text: string }

const isMarkdownPath = (path: string) => /\.md$/i.test(path);
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.');

/** The POSIX path from a folder (`.` for the root) to a vault path, such as `../Specs/Plan.md`. */
export function relativePath(fromFolder: string, to: string): string {
  const from = fromFolder === '.' ? [] : fromFolder.split('/');
  const parts = to.split('/');
  let shared = 0;
  while (shared < from.length && shared < parts.length - 1 && from[shared] === parts[shared]) shared++;
  return [...Array.from({ length: from.length - shared }, () => '..'), ...parts.slice(shared)].join('/');
}

/** `target` spelled like `previous`: Markdown targets drop `.md` when the previous path did. */
function withExtensionStyle(target: string, previous: string): string {
  return isMarkdownPath(target) && !isMarkdownPath(previous) ? target.slice(0, -3) : target;
}

/**
 * A vault-style link path (wikilinks, Canvas-like references) to `target` from `source`. A bare file name stays the
 * shortest unambiguous link text (Obsidian's `fileToLinktext`); a path keeps naming the full vault path.
 */
export function vaultLinkpath(index: LinkIndex, previous: string, target: string, source: string): string {
  const absolute = previous.startsWith('/');
  if (!previous.includes('/') || (absolute && !previous.slice(1).includes('/'))) {
    return fileToLinktext(index, target, source, !isMarkdownPath(previous));
  }
  return (absolute ? '/' : '') + withExtensionStyle(target, previous);
}

/** The new `[[…]]` or `![[…]]` source text, or undefined when its shape is not a wikilink naming `link`. */
export function rewriteWikilink(original: string, link: string, newPath: string): string | undefined {
  const embed = original.startsWith('!') ? '!' : '';
  if (!original.startsWith(`${embed}[[`) || !original.endsWith(']]')) return undefined;
  const inner = original.slice(embed.length + 2, -2);
  const path = parseLinktext(link).path;
  if (!inner.startsWith(path)) return undefined;
  return `${embed}[[${newPath}${inner.slice(path.length)}]]`;
}

/** Where a destination sits in a source text, relative to the text's start. */
export interface Destination { start: number; end: number; raw: string; angle: boolean }

function destinationAt(text: string, from: number): Destination | undefined {
  let start = from;
  while (text[start] === ' ' || text[start] === '\t' || text[start] === '\n') start++;
  if (text[start] === '<') {
    const close = text.indexOf('>', start);
    return close < 0 ? undefined : { start: start + 1, end: close, raw: text.slice(start + 1, close), angle: true };
  }
  let end = start, depth = 0;
  while (end < text.length && !/\s/.test(text[end]!)) {
    if (text[end] === '\\') { end += 2; continue; }
    if (text[end] === '(') depth++;
    else if (text[end] === ')') { if (depth === 0) break; depth--; }
    end++;
  }
  return end > start ? { start, end, raw: text.slice(start, end), angle: false } : undefined;
}

/** The destination of `[text](dest "title")` or `![alt](dest)` source text. */
export function markdownDestination(original: string): Destination | undefined {
  if (!original.endsWith(')')) return undefined;
  for (let open = original.lastIndexOf(']('); open >= 0; open = original.lastIndexOf('](', open - 1)) {
    const found = destinationAt(original, open + 2);
    if (!found) continue;
    const rest = original.slice(found.end + (found.angle ? 1 : 0), -1);
    if (/^\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))?\s*$/.test(rest)) return found;
    if (open === 0) break;
  }
  return undefined;
}

/** The destination of a reference definition such as `[id]: ../Plan.md "Title"`. */
export function definitionDestination(original: string): Destination | undefined {
  const colon = /^\s{0,3}\[(?:[^\]\\]|\\.)+\]:/.exec(original);
  return colon ? destinationAt(original, colon[0].length) : undefined;
}

/** The value of an `href="…"` or `src='…'` attribute text. */
export function attributeDestination(original: string): Destination | undefined {
  const match = /^[^=]+=\s*(["']?)/.exec(original);
  if (!match) return undefined;
  const quote = match[1]!, start = match[0].length;
  const end = quote ? original.indexOf(quote, start) : original.search(/\s|$/);
  return end < start ? undefined : { start, end, raw: original.slice(start, end), angle: false };
}

function decoded(raw: string): string {
  try { return decodeURI(raw); } catch { return raw; }
}

/**
 * A new relative-style destination (Markdown, reference definitions, HTML) for `target`. A destination that
 * resolved as a vault path (with or without a leading `/`) stays vault-absolute; otherwise the path is relative to
 * the source's new folder. The `#` fragment is kept verbatim, and a percent-encoded path stays encoded.
 */
export function rewriteDestination(destination: Destination, oldSource: string, oldTarget: string, newSource: string, target: string): string {
  const hash = destination.raw.indexOf('#');
  const rawPath = hash < 0 ? destination.raw : destination.raw.slice(0, hash), fragment = hash < 0 ? '' : destination.raw.slice(hash);
  const previous = decoded(rawPath);
  const leadingSlash = previous.startsWith('/');
  const viaVault = leadingSlash || (joinPath(folderOf(oldSource), previous) !== oldTarget && joinPath(folderOf(oldSource), `${previous}.md`) !== oldTarget);
  let path = viaVault ? (leadingSlash ? '/' : '') + target : relativePath(folderOf(newSource), target);
  if (!viaVault && previous.startsWith('./') && !path.startsWith('../')) path = `./${path}`;
  path = withExtensionStyle(path, previous);
  const encode = !destination.angle && (rawPath !== previous || /\s/.test(path));
  return (encode ? encodeURI(path) : path) + fragment;
}

/** The edit narrowed to the characters it changes: the text its original and new text share at both ends stays. */
function narrowed(edit: TextEdit): TextEdit {
  const { original, text } = edit, shortest = Math.min(original.length, text.length);
  let prefix = 0, suffix = 0;
  while (prefix < shortest && original[prefix] === text[prefix]) prefix++;
  while (suffix < shortest - prefix && original[original.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
  return { start: edit.start + prefix, end: edit.end - suffix, original: original.slice(prefix, original.length - suffix), text: text.slice(prefix, text.length - suffix) };
}

/**
 * Applies edits after checking that each still replaces its original text; undefined when one does not. Each edit
 * is narrowed to the characters it changes first, so a reference nested in another one, such as an image inside a
 * link's text or a wikilink in a link label, is rewritten together with it. An edit whose changed characters still
 * overlap an applied edit is left out and returned in `skipped`.
 */
export function applyEdits(text: string, edits: readonly TextEdit[]): { text: string; skipped: TextEdit[] } | undefined {
  if (edits.some(edit => text.slice(edit.start, edit.end) !== edit.original)) return undefined;
  const ordered = edits.map(edit => ({ edit, narrow: narrowed(edit) })).sort((a, b) => b.narrow.start - a.narrow.start || b.narrow.end - a.narrow.end);
  const skipped: TextEdit[] = [];
  let result = text, limit = Infinity, last: TextEdit | undefined;
  for (const { edit, narrow } of ordered) {
    // The same change listed twice is applied once.
    if (last && narrow.start === last.start && narrow.end === last.end && narrow.text === last.text) continue;
    if (narrow.end > limit) { skipped.push(edit); continue; }
    result = result.slice(0, narrow.start) + narrow.text + result.slice(narrow.end);
    limit = narrow.start; last = narrow;
  }
  return { text: result, skipped };
}
