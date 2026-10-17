import type { FileSnapshot, WriteRequest, FileChange, FileRename, FileStat, RemoveRequest, RenameRequest, GuardRequest } from '../../domain/documents/file.ts';
/** A batch outcome: file changes in request order and the folders it created, parent before child. */
export interface WriteBatchResult {
    changes: FileChange[];
    folders: string[];
}
/**
 * One guarded, locked batch. Check-only guards assert the initial file/folder revision (or absence) without
 * reporting changes; they may overlap mutation paths. A guard-only batch is valid. Renames apply first, in
 * order; writes then see the renamed files, so a write to a rename destination (or into a moved folder) is
 * guarded by the moved file's revision; removals apply last.
 */
export interface FileBatch {
    guards?: readonly GuardRequest[];
    renames?: readonly RenameRequest[];
    writes?: readonly WriteRequest[];
    removes?: readonly RemoveRequest[];
}
/**
 * `renames` in request order (folders expanded to their descendants), `changes` for writes in request order and
 * then one `deleted` change per removed file, `folders` the folders the batch created (parent before child) and
 * `removedFolders` the folders it removed (child before parent).
 */
export interface BatchResult {
    renames: FileRename[];
    changes: FileChange[];
    folders: string[];
    removedFolders: string[];
}
export interface FileRepository {
    read(path: string): Promise<FileSnapshot>;
    list(): Promise<string[]>;
    /** A file's revision and size, or a folder's revision and contents; NOT_FOUND when neither exists. */
    stat(path: string): Promise<FileStat>;
    /** Writes only; equivalent to `commit({ writes })`. */
    writeBatch(writes: readonly WriteRequest[], dryRun: boolean): Promise<WriteBatchResult>;
    /** One guarded file removal; equivalent to `commit({ removes: [{ path, expectedRevision }] })`. */
    remove(path: string, expectedRevision: string, dryRun: boolean): Promise<FileChange>;
    /**
     * Applies renames, writes and removals as one locked batch: every revision is checked first, a destination
     * that exists fails with DESTINATION_EXISTS, and a failure rolls back every applied step.
     */
    commit(batch: FileBatch, dryRun: boolean): Promise<BatchResult>;
}
/** The recorded holder of a lock file (never its release token). */
export interface LockHolder {
    pid: number;
    hostname: string;
    startedAt: string;
    command?: string;
    operationId?: number;
    forgeVersion?: string;
    pidNamespace?: string;
    bootId?: string;
    /** The holder process's start time as the host reports it (Linux: clock ticks after boot), to detect a reused pid. */
    processStart?: string;
}
/**
 * Why a lock's holder provably no longer runs: its pid runs no process on this host, the pid now belongs to another
 * process (a different start time, or this very process without holding the lock), or the lock was written before
 * this host's last restart.
 */
export type StaleReason = 'dead-process' | 'reused-pid' | 'rebooted';
/** A lock an acquisition found stale and removed before taking it; `path` is relative to the lock's root. */
export interface RecoveredLock {
    path: string;
    holder: LockHolder;
    reason: StaleReason;
}
/** A change that persisted: unchanged writes are never committed. */
export type CommittedChange = FileChange & {
    operation: 'created' | 'updated' | 'deleted';
};
/** The committed batch handed to observers: file renames (folder records omitted) and file changes, in batch order. */
export interface CommittedBatch {
    renames: readonly (FileRename & {
        kind: 'file';
    })[];
    changes: readonly CommittedChange[];
}
/**
 * Runs once per committed (never dry-run) batch, after the batch's `vault.*` records were published. Paths are
 * relative to the committing workspace. A failure is reported as a warning and cannot undo the commit.
 */
export interface CommitObserver {
    committed(batch: CommittedBatch): Promise<void>;
}
/** Replaces `original` by `text` inside the YAML string value at the dotted `key` (list items by index), as frontmatter links name it. */
export interface YamlStringReplacement {
    key: string;
    original: string;
    text: string;
}
/**
 * A Markdown text split at its YAML frontmatter as Obsidian reads it: `prefix` is a byte order mark or empty,
 * `yaml` the frontmatter source without its fences, `body` everything after the closing fence verbatim and
 * `newline` the text's first line ending. Without frontmatter `exists` is false, `yaml` is empty and `body` is the text.
 */
export interface MarkdownParts {
    prefix: string;
    yaml: string;
    body: string;
    newline: string;
    exists: boolean;
}
export interface DocumentCodec {
    /** Splits Markdown text at its frontmatter without changing any body byte; unclosed frontmatter is INVALID_FRONTMATTER. */
    markdownParts(text: string): MarkdownParts;
    /**
     * The parsed document by kind; invalid structure fails with its code. With `tolerant` (as `read` uses it), bytes
     * that are not UTF-8 return the base64 attachment form and a note whose frontmatter does not parse returns its
     * content with `properties: null` and an `issue: {code, message}`.
     */
    inspect(path: string, bytes: Uint8Array, options?: {
        tolerant?: boolean;
    }): unknown;
    validate(path: string, bytes: Uint8Array): void;
    /** Sets each top-level frontmatter property in `changes` and deletes each key in `remove`, preserving the body and YAML formatting. */
    properties(bytes: Uint8Array, changes: Record<string, unknown>, remove?: readonly string[]): Uint8Array;
    patch(path: string, bytes: Uint8Array, pointer: string, value: unknown): Uint8Array;
    /**
     * Applies replacements inside the string values of a YAML text in one pass per value, so no replacement rewrites
     * another's output. A changed value keeps its quoting style when it fits, otherwise it becomes double-quoted; all
     * other bytes stay. `applied` lists the indexes of the replacements made.
     */
    replaceInYamlStrings(yaml: string, replacements: readonly YamlStringReplacement[]): {
        yaml: string;
        applied: number[];
    };
}
