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
export type LinkResolution = {
    status: 'resolved';
    path: string;
    via: 'path' | 'alias';
} | {
    status: 'unresolved';
    linkpath: string;
    reason: 'missing';
} | {
    status: 'unresolved';
    linkpath: string;
    reason: 'ambiguous';
    via: 'path' | 'alias';
    candidates: string[];
} | {
    status: 'external';
};
/** `relative` resolves from the source folder first (Markdown and HTML links); `aliases` falls back to note aliases. */
export interface ResolveOptions {
    relative?: boolean;
    aliases?: boolean;
}
export declare const isExternalLink: (target: string) => boolean;
export declare function linkIndex(paths: readonly string[], aliases?: ReadonlyMap<string, readonly string[]>): LinkIndex;
/** `posix.normalize(posix.join(folder, target))` for relative vault paths. */
export declare function joinPath(folder: string, target: string): string;
/**
 * Resolves link text from a source path: the subpath is ignored and an empty path names the source. Exact
 * spellings (with or without `.md`) win, then one case-insensitive match, then, for vault-style links, one
 * case-insensitive `/`-suffix match, then optionally one alias. Several equally good matches are ambiguous.
 */
export declare function resolveLinkpath(index: LinkIndex, link: string, source: string, options?: ResolveOptions): LinkResolution;
/**
 * The candidate an Obsidian-style lookup opens for an ambiguous path match: the one whose folder is the fewest
 * folder steps from the source's folder (steps up to their deepest common folder plus steps down from it), then
 * the one with the fewest path segments, then the first in vault path order. A candidate in the source's own
 * folder is therefore always chosen.
 */
export declare function closestCandidate(candidates: readonly string[], source: string): string;
/**
 * The file a resolution opens like Obsidian's `getFirstLinkpathDest`: a resolved path, or for a link whose path
 * matches several files, the closest candidate. Missing targets and alias matches stay null.
 */
export declare function closestDestination(resolution: LinkResolution, source: string): string | null;
/**
 * Obsidian's default "shortest" link text for `path` from `source`: the file name when it resolves back to the
 * file, otherwise the full path. Markdown files omit `.md` unless `omitMdExtension` is false.
 */
export declare function fileToLinktext(index: LinkIndex, path: string, source: string, omitMdExtension?: boolean): string;
