import type { CachedMetadata } from './cache.ts';
/** The layout version of a stored metadata snapshot; a snapshot of another layout is ignored. */
export declare const snapshotFormat = 1;
/**
 * How long after a listing a file's timestamps stay too recent to trust (git's "racy clean" rule). A file changed
 * within the same timestamp tick as a read could keep its stamp, so files whose last modification or status change
 * lies within this window of the listing are re-read. Two seconds covers FAT's mtime resolution and small clock skew.
 */
export declare const racyWindowMs = 2000;
/** What parsing produced for one content revision: the file's metadata, or why the content could not be parsed. */
export type ParseOutcome = {
    metadata: CachedMetadata;
} | {
    issue: {
        code: string;
        message: string;
    };
};
/**
 * One indexed file as last seen. `stamp` describes the file's filesystem state taken before its content was read,
 * or is null when the content was read without one (after a commit), so the next load re-reads it.
 */
export interface SnapshotFile {
    stamp: string | null;
    revision: string;
}
/**
 * The parse results of one scope's vault, stored between invocations. `key` names the Forge build, parser and scope
 * the results belong to; `checkedAtMs` is when the stamps were taken; `outcomes` are keyed by `outcomeKey`.
 * Only parse results are stored: link resolution, backlinks and link counts are always recomputed.
 */
export interface MetadataSnapshot {
    format: typeof snapshotFormat;
    key: string;
    checkedAtMs: number;
    files: Record<string, SnapshotFile>;
    outcomes: Record<string, ParseOutcome>;
}
/** A file's current filesystem stamp and the later of its modification and status-change times. */
export interface FileStamp {
    stamp: string;
    changedMs: number;
}
/**
 * The key of a parse outcome. Parsing depends only on the bytes and the file kind (Markdown or Canvas), so equal
 * content reuses one result under any path: renamed and moved files are not parsed again.
 */
export declare const outcomeKey: (path: string, revision: string) => string;
/**
 * Whether a stored file can be reused without reading it: its stamp is unchanged and its last change happened
 * before the racy window of the listing that stored it.
 */
export declare function unchangedFile(stored: SnapshotFile | undefined, current: FileStamp | undefined, checkedAtMs: number): boolean;
/**
 * The stored value as a snapshot for `key`, or null when it has another format or key or any part has the wrong
 * shape: a snapshot is reused completely or not at all.
 */
export declare function readSnapshot(value: unknown, key: string): MetadataSnapshot | null;
