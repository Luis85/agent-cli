import type { MetadataCache, MetadataIssue, SourceReference } from '../../../application/metadata/ports.ts';
import { fileKind, vaultPath } from '../../../domain/documents/file.ts';
import { ensure } from '../../../domain/shared/errors.ts';

/**
 * One reference with its source location and resolution. Body links and embeds carry a 1-based `line` and
 * `column` and a zero-based `offset`; frontmatter links carry their property `key` and Canvas file nodes their
 * `node` id instead. `target` and `via` describe a resolved link; `reason` (and `candidates` when ambiguous) an
 * unresolved one. External URLs have `status: "external"`.
 */
export interface LinkEntry {
  source: string;
  kind: SourceReference['kind'];
  line?: number; column?: number; offset?: number;
  key?: string; node?: string;
  original: string; link: string; displayText?: string;
  status: 'resolved' | 'unresolved' | 'external';
  target?: string; via?: 'path' | 'alias';
  reason?: 'missing' | 'ambiguous'; candidates?: string[];
}

/** Notes are the files the cache parses for links: Markdown and Canvas. */
const isNote = (path: string) => ['markdown', 'canvas'].includes(fileKind(path));

function location(item: SourceReference): Pick<LinkEntry, 'line' | 'column' | 'offset' | 'key' | 'node'> {
  if (item.kind === 'frontmatter') return { key: item.reference.key };
  if (item.kind === 'canvas') return { node: item.reference.node };
  const { line, col, offset } = item.reference.position.start;
  return { line: line + 1, column: col + 1, offset };
}

function linkEntry(source: string, item: SourceReference): LinkEntry {
  const { kind, reference, resolution } = item;
  const resolved = resolution.status === 'resolved' ? { target: resolution.path, via: resolution.via }
    : resolution.status === 'unresolved' ? { reason: resolution.reason, ...(resolution.reason === 'ambiguous' ? { candidates: resolution.candidates } : {}) } : {};
  return {
    source, kind, ...location(item), original: reference.original, link: reference.link,
    ...(reference.displayText === undefined ? {} : { displayText: reference.displayText }),
    status: resolution.status, ...resolved,
  };
}

/** A reference that leaves its source: not an external URL and not a link to the source itself. */
const outbound = (source: string, { resolution }: SourceReference) =>
  resolution.status !== 'external' && !(resolution.status === 'resolved' && resolution.path === source);

// Link reports over one loaded metadata cache. Paths are root-relative; every list follows vault path order and
// then each source's reference order. `issues` names files the cache could not parse: their links are missing.

function indexed(cache: MetadataCache, note: string): string {
  const path = vaultPath(note);
  ensure(cache.files().includes(path), 'NOT_FOUND', `${path} is not a visible file of the vault; run list to find its path.`);
  return path;
}

/** Outgoing references of one indexed file, with that file's parse issue if any. */
export function linksOut(cache: MetadataCache, note: string): { path: string; links: LinkEntry[]; issues: MetadataIssue[] } {
  const path = indexed(cache, note);
  return { path, links: cache.references(path).map(reference => linkEntry(path, reference)), issues: cache.issues().filter(issue => issue.path === path) };
}

/** References in other files that resolve to one indexed file. */
export function linksBack(cache: MetadataCache, note: string): { path: string; backlinks: LinkEntry[]; issues: MetadataIssue[] } {
  const path = indexed(cache, note);
  return { path, backlinks: cache.backlinks(path).map(({ source, ...reference }) => linkEntry(source, reference as SourceReference)), issues: cache.issues() };
}

/** Every missing or ambiguous reference, from sources that match `include`. */
export function unresolvedLinks(cache: MetadataCache, include: (path: string) => boolean): { links: LinkEntry[]; issues: MetadataIssue[] } {
  const links = cache.files().filter(include).flatMap(source => cache.references(source)
    .filter(reference => reference.resolution.status === 'unresolved').map(reference => linkEntry(source, reference)));
  return { links, issues: cache.issues() };
}

/** Notes that no other file links to or embeds, except those matching `root`. */
export function orphanNotes(cache: MetadataCache, include: (path: string) => boolean, root: (path: string) => boolean): { files: string[]; issues: MetadataIssue[] } {
  const files = cache.files().filter(path => isNote(path) && include(path) && !root(path) && cache.backlinks(path).length === 0);
  return { files, issues: cache.issues() };
}

/** Parsed notes without a reference to another file, resolved or not. Unparseable notes are reported as issues. */
export function deadendNotes(cache: MetadataCache, include: (path: string) => boolean): { files: string[]; issues: MetadataIssue[] } {
  const files = cache.files().filter(path => isNote(path) && include(path) && cache.getFileCache(path) !== null
    && !cache.references(path).some(reference => outbound(path, reference)));
  return { files, issues: cache.issues() };
}
