import { type WriteRequest, type FileChange, type PlannedChange } from '../../domain/documents/file.ts';
import type { FileRepository, DocumentCodec, CommitObserver } from './ports.ts';
import type { EventBus } from '../plugins/events.ts';
/** Dry-run result options; `diff` adds a unified diff to each planned change. */
export interface WriteOptions {
    diff?: boolean;
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
        dryRun: true;
        changes: FileChange[];
    } | {
        dryRun: false;
        changes: FileChange[];
    }>;
    /**
     * Dry runs emit one `workspace.quick-preview` per planned file. Commits emit `vault.create` for each new
     * folder (parent before child), then one `vault.*` record per file in batch order, then run the commit observer.
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
