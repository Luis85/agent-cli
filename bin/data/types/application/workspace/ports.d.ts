import type { FileSnapshot, WriteRequest, FileChange } from '../../domain/documents/file.ts';
/** A batch outcome: file changes in request order and the folders it created, parent before child. */
export interface WriteBatchResult {
    changes: FileChange[];
    folders: string[];
}
export interface FileRepository {
    read(path: string): Promise<FileSnapshot>;
    list(): Promise<string[]>;
    writeBatch(writes: readonly WriteRequest[], dryRun: boolean): Promise<WriteBatchResult>;
    remove(path: string, expectedRevision: string, dryRun: boolean): Promise<FileChange>;
}
/**
 * Runs once per committed (never dry-run) batch, after the batch's `vault.*` records were published. `changes` are
 * the batch's file changes in batch order, with paths relative to the committing workspace. A failure is reported
 * as a warning and cannot undo the commit.
 */
export interface CommitObserver {
    committed(changes: readonly FileChange[]): Promise<void>;
}
export interface DocumentCodec {
    inspect(path: string, bytes: Uint8Array): unknown;
    validate(path: string, bytes: Uint8Array): void;
    properties(bytes: Uint8Array, changes: Record<string, unknown>): Uint8Array;
    patch(path: string, bytes: Uint8Array, pointer: string, value: unknown): Uint8Array;
}
