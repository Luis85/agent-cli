import type { CachedMetadata, CanvasLinkCache, FrontmatterLinkCache, LinkCache } from '../../domain/metadata/cache.ts';
import type { LinkResolution } from '../../domain/metadata/link-resolution.ts';
import type { FileStamp, MetadataSnapshot } from '../../domain/metadata/snapshot.ts';
import type { FileRepository } from '../workspace/ports.ts';
/** Source path → destination path (resolved) or link text (unresolved) → number of references. */
export type LinkCounts = Record<string, Record<string, number>>;
/**
 * One outgoing reference of a source file with its resolution. Body links and embeds come first in document
 * order, then frontmatter links in property order, then Canvas file nodes in node order.
 */
export type SourceReference = {
    kind: 'link' | 'embed';
    reference: LinkCache;
    resolution: LinkResolution;
} | {
    kind: 'frontmatter';
    reference: FrontmatterLinkCache;
    resolution: LinkResolution;
} | {
    kind: 'canvas';
    reference: CanvasLinkCache;
    resolution: LinkResolution;
};
/** A reference from `source` that resolves to the requested file. */
export type Backlink = SourceReference & {
    source: string;
};
/** A visible Markdown or Canvas file that could not be parsed; it has no file cache until it is fixed. */
export interface MetadataIssue {
    path: string;
    code: string;
    message: string;
}
/** A committed change to apply incrementally. `renamed` removes `oldPath` and indexes `path`. */
export type MetadataChange = {
    path: string;
    operation: 'created' | 'updated' | 'deleted';
} | {
    path: string;
    operation: 'renamed';
    oldPath: string;
};
/**
 * Paths affected by an update, in vault path order: `changed` files were re-indexed, `deleted` files left the
 * index, and `resolved` sources had their `resolvedLinks`/`unresolvedLinks` entries recomputed with a different
 * result or new references. `prevCaches` holds each deleted file's metadata before the update, or null when it
 * had none (non-Markdown, non-Canvas or unparseable files).
 */
export interface MetadataUpdate {
    changed: string[];
    deleted: string[];
    resolved: string[];
    prevCaches: Record<string, CachedMetadata | null>;
}
/** Read access to a loaded vault metadata index. Paths are relative to the bound workspace or project root. */
export interface MetadataCache {
    /**
     * Vault paths in repository order: dot-prefixed files and folders are excluded and, at the workspace root, so is
     * the workspace's own `bin/` distribution. The same array is returned until an update, which replaces it.
     */
    files(): readonly string[];
    /** The parsed metadata of a Markdown or Canvas file, or null for other, unknown or unparseable files. */
    getFileCache(path: string): CachedMetadata | null;
    /** The file that link text resolves to from `sourcePath`, ignoring any subpath; null when missing or ambiguous. */
    getFirstLinkpathDest(linkpath: string, sourcePath: string): string | null;
    /**
     * Like `getFirstLinkpathDest`, but a link text whose path matches several files opens the closest one, as
     * Obsidian does (`closestCandidate`); null only when no file matches.
     */
    getClosestLinkpathDest(linkpath: string, sourcePath: string): string | null;
    /** The shortest link text that resolves from `sourcePath` to `path`. */
    fileToLinktext(path: string, sourcePath: string, omitMdExtension?: boolean): string;
    readonly resolvedLinks: LinkCounts;
    readonly unresolvedLinks: LinkCounts;
    /** Outgoing references of a source with their resolution; empty for unindexed files. */
    references(sourcePath: string): readonly SourceReference[];
    /** References from other files that resolve to `path`, by source path and then reference order. */
    backlinks(path: string): Backlink[];
    issues(): MetadataIssue[];
}
/** The invocation's lazily built metadata index and its post-commit update hook. */
export interface MetadataIndex {
    /** Builds the index on first use and returns the same live cache afterwards. */
    load(): Promise<MetadataCache>;
    /**
     * The vault's paths in repository order without building the index: the cache's `files()` once loaded, else the
     * repository listing filtered by the same vault rule (no dot-prefixed segment and, at the workspace root, nothing
     * below the workspace's `bin/` distribution).
     */
    vaultFiles(): Promise<readonly string[]>;
    /**
     * One file's metadata from content the caller already read, without building or changing the index: what
     * `getFileCache` would hold for these bytes, or null for files the index does not parse or that fail to parse.
     * The index computes the content revision of `bytes` itself and reuses the loaded index's or a stored snapshot's
     * result only for that revision, so any bytes, such as planned content, get their own metadata. A `FileSnapshot`
     * can be passed as is; its `revision` is not consulted.
     */
    parseFile(file: {
        path: string;
        bytes: Uint8Array;
    }): Promise<CachedMetadata | null>;
    /**
     * The metadata of content at any path the parser handles, inside or outside the vault rule, such as the headings
     * and blocks a section edit addresses. Invalid content throws its parse error; other files return null.
     */
    parseContent(path: string, bytes: Uint8Array): CachedMetadata | null;
    /**
     * An index with the same parser and vault rule over another repository of this scope, such as a staged view of
     * planned changes. When this index is loaded, the fork starts from a copy of its state instead of reading every
     * file again; afterwards updates to either index never reach the other.
     */
    fork(repository: FileRepository): Promise<MetadataIndex>;
    /**
     * Re-indexes committed changes and re-resolves affected sources. Before the first load it changes nothing and
     * returns null, because the later load reads the current files.
     */
    update(changes: readonly MetadataChange[]): Promise<MetadataUpdate | null>;
    /** Re-reads the given paths from the repository, treating missing files as deleted; null before the first load. */
    invalidate(paths: readonly string[]): Promise<MetadataUpdate | null>;
}
/** Parses one file's bytes into Obsidian-shaped metadata. */
export interface MetadataParser {
    /** Whether a path is parsed; other visible files are indexed as link targets only. */
    indexes(path: string): boolean;
    /** Throws when the content is invalid for its format. */
    parse(path: string, bytes: Uint8Array): CachedMetadata;
}
/**
 * The scope's files, those the index asked for with stamps of their filesystem state, taken after `checkedAtMs` and
 * before any content read.
 */
export interface StampedListing {
    checkedAtMs: number;
    files: ReadonlyArray<{
        path: string;
    } | ({
        path: string;
    } & FileStamp)>;
}
/**
 * Persists the metadata index's parse results between invocations as derived data outside the vault: no events, no
 * writer lock and no workspace write. The index trusts a stored file only while its stamp is unchanged and outside
 * the racy window, otherwise it reads the file and reuses a result only for the same content revision, so the store
 * never needs to be current. The repository it serves must report SHA-256 content revisions.
 */
export interface MetadataSnapshotStore {
    /**
     * Every file that the scope repository's `list()` returns, in the same order; each file that `stamped` accepts
     * (the files the index parses) carries its current stamp, the others only their path.
     */
    listing(stamped: (path: string) => boolean): Promise<StampedListing>;
    /**
     * The stored snapshot as written, or null when there is none or it cannot be read intact; never throws. Each call
     * returns a new value, which the index decodes in place.
     */
    load(): Promise<unknown>;
    /** Replaces the stored snapshot atomically; a failure leaves the previous snapshot or none. */
    save(snapshot: MetadataSnapshot): Promise<void>;
}
