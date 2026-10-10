import { type WriteRequest, type FileChange, type PlannedChange } from '../../domain/documents/file.ts';
import type { FileRepository, DocumentCodec } from './ports.ts';
import type { EventBus } from '../plugins/events.ts';
/** Dry-run result options; `diff` adds a unified diff to each planned change. */
export interface WriteOptions {
    diff?: boolean;
}
export declare class Workspace {
    readonly files: FileRepository;
    readonly codec: DocumentCodec;
    readonly events: EventBus;
    readonly dryRun: boolean;
    readonly root: string | null;
    constructor(files: FileRepository, codec: DocumentCodec, events: EventBus, dryRun: boolean, root?: string | null);
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
    private committed;
    edit(path: string, revision: string, transform: (bytes: Uint8Array) => Uint8Array): Promise<{
        dryRun: boolean;
        changes: Array<FileChange | PlannedChange>;
    }>;
    private observe;
}
