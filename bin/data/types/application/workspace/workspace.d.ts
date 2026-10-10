import { type WriteRequest, type FileChange, type FileRename, type FileSnapshot, type PlannedChange } from '../../domain/documents/file.ts';
import type { FileRepository, DocumentCodec, CommitObserver, FileBatch } from './ports.ts';
import type { EventBus } from '../plugins/events.ts';
/** Dry-run result options; `diff` adds a unified diff to each planned change. */
export interface WriteOptions {
    diff?: boolean;
}
/**
 * How a mixed batch is reported. `trash` lists trash destinations: renames to or into them are reported as
 * deletions, because they move files into the hidden `.trash` folder, and no records are published for folders the
 * batch creates in `.trash`. A write inside a trash destination (a plan that edits a file and then deletes it) only
 * gives the trashed file its final content: it is neither reported as a change nor published, so the file reads as
 * deleted. `previous` holds the snapshots a dry run diffs each write against, keyed by the written path; without it
 * dry runs carry no diffs.
 */
export interface CommitOptions {
    operation: 'move' | 'delete' | 'apply';
    trash?: readonly string[];
    previous?: ReadonlyMap<string, FileSnapshot>;
}
export declare class Workspace {
    readonly files: FileRepository;
    readonly codec: DocumentCodec;
    private readonly events;
    readonly dryRun: boolean;
    readonly root: string | null;
    private readonly observer?;
    /** `observer` follows each committed batch of this scope, such as the metadata cache of the same root. */
    constructor(files: FileRepository, codec: DocumentCodec, events: EventBus, dryRun: boolean, root?: string | null, observer?: CommitObserver | undefined);
    /**
     * The same invocation (events, codec, dry run) over another repository scope, such as a selected project.
     * Commit observers are bound to one scope, so the new scope has only the `observer` given here.
     */
    within(files: FileRepository, root: string | null, observer?: CommitObserver): Workspace;
    read(path: string): Promise<{
        path: string;
        revision: string;
        bytes: number;
        document: unknown;
    }>;
    write(writes: readonly WriteRequest[], options?: WriteOptions): Promise<{
        dryRun: boolean;
        changes: Array<FileChange | PlannedChange>;
    }>;
    /** `previous` enables preview diffs and supplies snapshots the caller already read. */
    private guardedWrite;
    /** Diff each planned file against the revision that the dry run checked; binary content has no diff. */
    private preview;
    remove(path: string, expectedRevision: string): Promise<{
        dryRun: boolean;
        changes: FileChange[];
    }>;
    /**
     * One guarded batch of renames, writes and removals (see `FileRepository.commit`). Structured writes are
     * validated first; dry runs return each write's diff when `options.previous` is given.
     */
    commit(batch: FileBatch, options: CommitOptions): Promise<{
        dryRun: boolean;
        renames: FileRename[];
        changes: FileChange[];
        folders: string[];
        removedFolders: string[];
    }>;
    /**
     * Dry runs emit one `workspace.quick-preview` per planned file change. Commits emit `vault.create` for each new
     * folder (parent before child), one `vault.rename` per moved folder or file, one `vault.*` record per file change
     * in batch order, then `vault.delete` per removed folder (child before parent), and finally run the commit
     * observer. Renames into a `trash` destination are reported after the other renames: each moved file, then each
     * moved folder (child before parent), as `vault.delete`.
     */
    private committed;
    private notify;
    private warn;
    edit(path: string, revision: string, transform: (bytes: Uint8Array) => Uint8Array): Promise<{
        dryRun: boolean;
        changes: Array<FileChange | PlannedChange>;
    }>;
    private observe;
}
