import { parseLinktext } from './cache.ts';

/**
 * Vault paths in index order, keyed by exact spelling, lowercase spelling, each lowercase suffix that follows
 * a `/`, and each note's lowercase aliases. Lookups are hash-map hits, so resolving every link stays linear.
 */
export interface LinkIndex {
  paths: readonly string[];
  exact: ReadonlySet<string>;
  lower: ReadonlyMap<string, number[]>;
  suffixes: ReadonlyMap<string, number[]>;
  aliases: ReadonlyMap<string, number[]>;
}

/** How one link target resolved. Ambiguous candidates are listed in vault path order. */
export type LinkResolution =
  | { status: 'resolved'; path: string; via: 'path' | 'alias' }
  | { status: 'unresolved'; linkpath: string; reason: 'missing' }
  | { status: 'unresolved'; linkpath: string; reason: 'ambiguous'; via: 'path' | 'alias'; candidates: string[] }
  | { status: 'external' };

/** `relative` resolves from the source folder first (Markdown and HTML links); `aliases` falls back to note aliases. */
export interface ResolveOptions { relative?: boolean; aliases?: boolean }

const external = (target: string) => /^[a-z][a-z\d+.-]*:|^\/\//i.test(target);
export const isExternalLink = external;

export function linkIndex(paths: readonly string[], aliases: ReadonlyMap<string, readonly string[]> = new Map()): LinkIndex {
  const lower = new Map<string, number[]>(), suffixes = new Map<string, number[]>(), aliasKeys = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, position: number) => {
    const positions = map.get(key);
    if (!positions) map.set(key, [position]);
    else if (positions.at(-1) !== position) positions.push(position);
  };
  for (const [position, path] of paths.entries()) {
    const folded = path.toLowerCase();
    add(lower, folded, position);
    for (let slash = folded.indexOf('/'); slash >= 0; slash = folded.indexOf('/', slash + 1)) add(suffixes, folded.slice(slash + 1), position);
    for (const alias of aliases.get(path) ?? []) add(aliasKeys, alias.toLowerCase(), position);
  }
  return { paths, exact: new Set(paths), lower, suffixes, aliases: aliasKeys };
}

/** The folder of a vault path, `.` at the root, like `posix.dirname`. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '.' : slash === 0 ? '/' : path.slice(0, slash);
}

/** `posix.normalize(posix.join(folder, target))` for relative vault paths. */
export function joinPath(folder: string, target: string): string {
  const parts: string[] = [];
  for (const part of `${folder}/${target}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length > 0 && parts.at(-1) !== '..') parts.pop();
    else parts.push(part);
  }
  const joined = parts.join('/') || '.';
  return target.endsWith('/') ? `${joined}/` : joined;
}

// Paths whose key equals the lowercase spelling with or without `.md`, in vault path order.
function lookup(index: LinkIndex, keys: ReadonlyMap<string, number[]>, spelling: string): string[] {
  const positions = new Set([...keys.get(spelling.toLowerCase()) ?? [], ...keys.get(`${spelling}.md`.toLowerCase()) ?? []]);
  return [...positions].sort((a, b) => a - b).map(position => index.paths[position]!);
}

function matched(found: string[], linkpath: string, via: 'path' | 'alias'): LinkResolution | undefined {
  if (found.length === 1) return { status: 'resolved', path: found[0]!, via };
  if (found.length > 1) return { status: 'unresolved', linkpath, reason: 'ambiguous', via, candidates: found };
  return undefined;
}

/**
 * Resolves link text from a source path: the subpath is ignored and an empty path names the source. Exact
 * spellings (with or without `.md`) win, then one case-insensitive match, then, for vault-style links, one
 * case-insensitive `/`-suffix match, then optionally one alias. Several equally good matches are ambiguous.
 */
export function resolveLinkpath(index: LinkIndex, link: string, source: string, options: ResolveOptions = {}): LinkResolution {
  let target = parseLinktext(link).path;
  if (!target) return { status: 'resolved', path: source, via: 'path' };
  if (external(target)) return { status: 'external' };
  target = target.replace(/^\//, '');
  const relative = options.relative === true;
  const local = joinPath(folderOf(source), target);
  const candidates = relative ? [local, target] : [target, local];
  for (const candidate of candidates) {
    for (const spelling of [candidate, `${candidate}.md`]) {
      if (index.exact.has(spelling)) return { status: 'resolved', path: spelling, via: 'path' };
    }
  }
  for (const candidate of candidates) {
    const result = matched(lookup(index, index.lower, candidate), target, 'path');
    if (result) return result;
  }
  if (relative || target.startsWith('../')) return { status: 'unresolved', linkpath: target, reason: 'missing' };
  const suffix = matched(lookup(index, index.suffixes, target), target, 'path');
  if (suffix) return suffix;
  const alias = options.aliases ? matched([...new Set(index.aliases.get(target.toLowerCase()) ?? [])].map(position => index.paths[position]!), target, 'alias') : undefined;
  return alias ?? { status: 'unresolved', linkpath: target, reason: 'missing' };
}

const folderParts = (path: string) => path.split('/').slice(0, -1);

/**
 * The candidate an Obsidian-style lookup opens for an ambiguous path match: the one whose folder is the fewest
 * folder steps from the source's folder (steps up to their deepest common folder plus steps down from it), then
 * the one with the fewest path segments, then the first in vault path order. A candidate in the source's own
 * folder is therefore always chosen.
 */
export function closestCandidate(candidates: readonly string[], source: string): string {
  const from = folderParts(source);
  const distance = (path: string) => {
    const to = folderParts(path);
    let common = 0;
    while (common < from.length && common < to.length && from[common] === to[common]) common++;
    return from.length - common + to.length - common;
  };
  const ranked = candidates.map(path => ({ path, distance: distance(path), depth: path.split('/').length }));
  ranked.sort((a, b) => a.distance - b.distance || a.depth - b.depth || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return ranked[0]!.path;
}

/**
 * The file a resolution opens like Obsidian's `getFirstLinkpathDest`: a resolved path, or for a link whose path
 * matches several files, the closest candidate. Missing targets and alias matches stay null.
 */
export function closestDestination(resolution: LinkResolution, source: string): string | null {
  if (resolution.status === 'resolved' && resolution.via === 'path') return resolution.path;
  if (resolution.status === 'unresolved' && resolution.reason === 'ambiguous' && resolution.via === 'path') return closestCandidate(resolution.candidates, source);
  return null;
}

/**
 * Obsidian's default "shortest" link text for `path` from `source`: the file name when it resolves back to the
 * file, otherwise the full path. Markdown files omit `.md` unless `omitMdExtension` is false.
 */
export function fileToLinktext(index: LinkIndex, path: string, source: string, omitMdExtension = true): string {
  const spelling = (value: string) => omitMdExtension && value.toLowerCase().endsWith('.md') ? value.slice(0, -3) : value;
  const resolvesTo = (link: string) => {
    if (parseLinktext(link).path !== link || !link) return false;
    const result = resolveLinkpath(index, link, source);
    return result.status === 'resolved' && result.path === path;
  };
  for (const candidate of [spelling(path.slice(path.lastIndexOf('/') + 1)), spelling(path)]) {
    if (resolvesTo(candidate)) return candidate;
  }
  return path;
}
