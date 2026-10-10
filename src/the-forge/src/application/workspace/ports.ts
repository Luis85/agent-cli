import type { FileSnapshot, WriteRequest, FileChange, FileRename, FileStat, RemoveRequest, RenameRequest } from '../../domain/documents/file.ts';

/** A batch outcome: file changes in request order and the folders it created, parent before child. */
export interface WriteBatchResult { changes: FileChange[]; folders: string[] }
/**
 * One guarded, locked batch. Renames apply first, in order; writes then see the renamed files, so a write to a
 * rename destination (or into a moved folder) is guarded by the moved file's revision; removals apply last.
 */
export interface FileBatch { renames?: readonly RenameRequest[]; writes?: readonly WriteRequest[]; removes?: readonly RemoveRequest[] }
/**
 * `renames` in request order (folders expanded to their descendants), `changes` for writes in request order and
 * then one `deleted` change per removed file, `folders` the folders the batch created (parent before child) and
 * `removedFolders` the folders it removed (child before parent).
 */
export interface BatchResult { renames: FileRename[]; changes: FileChange[]; folders: string[]; removedFolders: string[] }
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
/** The committed batch handed to observers: file renames (folder records omitted) and file changes, in batch order. */
export interface CommittedBatch { renames: readonly (FileRename & { kind: 'file' })[]; changes: readonly FileChange[] }
/**
 * Runs once per committed (never dry-run) batch, after the batch's `vault.*` records were published. Paths are
 * relative to the committing workspace. A failure is reported as a warning and cannot undo the commit.
 */
export interface CommitObserver { committed(batch: CommittedBatch): Promise<void> }
export interface DocumentCodec {
  inspect(path: string, bytes: Uint8Array): unknown;
  validate(path: string, bytes: Uint8Array): void;
  /** Sets each top-level frontmatter property in `changes` and deletes each key in `remove`, preserving the body and YAML formatting. */
  properties(bytes: Uint8Array, changes: Record<string, unknown>, remove?: readonly string[]): Uint8Array;
  patch(path: string, bytes: Uint8Array, pointer: string, value: unknown): Uint8Array;
}
