import { AppError, ensure, isRecord, restatedError } from '../../domain/shared/errors.ts';
import { vaultPath, type FileChange, type FileRename, type FileSnapshot, type FileStat, type WriteRequest } from '../../domain/documents/file.ts';
import { snapshotBatch } from './batch-plan.ts';
import { snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import type { BatchResult, CommitObserver, CommittedChange, FileBatch, FileRepository, WriteBatchResult } from './ports.ts';

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Project-relative paths with the parent repository's lock and filesystem guards. Failures of the parent repository
 * name paths relative to this scope too, in their message and in every string of their details.
 */
export class ScopedFiles implements FileRepository {
  private readonly prefix: string;
  private readonly inMessage: RegExp;

  constructor(private readonly files: FileRepository, directory: string) {
    this.prefix = `${vaultPath(directory)}/`;
    this.inMessage = new RegExp(`(?<![\\w./-])${escaped(this.prefix)}`, 'g');
  }

  async read(path: string): Promise<FileSnapshot> {
    const relative = vaultPath(path);
    return { ...await this.scoped(() => this.files.read(this.prefix + relative)), path: relative };
  }

  async list(): Promise<string[]> {
    return (await this.files.list()).filter(path => path.startsWith(this.prefix)).map(path => this.relative(path));
  }

  /** Folders created above the project directory are outside this scope and are not reported. */
  async writeBatch(writes: readonly WriteRequest[], dryRun: boolean): Promise<WriteBatchResult> {
    const requests = snapshotWriteRequests(writes).map(write => ({ ...write, path: this.prefix + write.path }));
    const { changes, folders } = await this.scoped(() => this.files.writeBatch(requests, dryRun));
    return {
      changes: changes.map(change => ({ ...change, path: this.relative(change.path) })),
      folders: folders.filter(folder => folder.startsWith(this.prefix)).map(folder => this.relative(folder)),
    };
  }

  async remove(path: string, expectedRevision: string, dryRun: boolean): Promise<FileChange> {
    const change = await this.scoped(() => this.files.remove(this.prefix + vaultPath(path), expectedRevision, dryRun));
    return { ...change, path: this.relative(change.path) };
  }

  async stat(path: string): Promise<FileStat> {
    return { ...await this.scoped(() => this.files.stat(this.prefix + vaultPath(path))), path: vaultPath(path) };
  }

  /** Folders created or removed above the project directory are outside this scope and are not reported. */
  async commit(batch: FileBatch, dryRun: boolean): Promise<BatchResult> {
    batch = snapshotBatch(batch);
    const result = await this.scoped(() => this.files.commit({
      guards: (batch.guards ?? []).map(guard => ({ ...guard, path: this.prefix + guard.path })),
      renames: (batch.renames ?? []).map(rename => ({ ...rename, from: this.prefix + vaultPath(rename.from), to: this.prefix + vaultPath(rename.to) })),
      writes: snapshotWriteRequests(batch.writes ?? []).map(write => ({ ...write, path: this.prefix + write.path })),
      removes: (batch.removes ?? []).map(remove => ({ ...remove, path: this.prefix + vaultPath(remove.path) })),
    }, dryRun));
    const inScope = (folders: string[]) => folders.filter(folder => folder.startsWith(this.prefix)).map(folder => this.relative(folder));
    return {
      renames: result.renames.map(rename => ({ ...rename, from: this.relative(rename.from), to: this.relative(rename.to) })),
      changes: result.changes.map(change => ({ ...change, path: this.relative(change.path) })),
      folders: inScope(result.folders),
      removedFolders: inScope(result.removedFolders),
    };
  }

  /** Runs a parent repository call, translating the paths its failure names into this scope. */
  private async scoped<T>(call: () => Promise<T>): Promise<T> {
    try { return await call(); }
    catch (error) {
      if (!(error instanceof AppError)) throw error;
      const details = error.details && this.unprefixed(error.details) as Record<string, unknown>;
      throw restatedError(error, error.message.replace(this.inMessage, ''), details);
    }
  }

  private unprefixed(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') return value.startsWith(this.prefix) ? value.slice(this.prefix.length) : value;
    if (depth > 3) return value;
    if (Array.isArray(value)) return value.map(item => this.unprefixed(item, depth + 1));
    return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.unprefixed(item, depth + 1)])) : value;
  }

  private relative(path: string): string {
    ensure(path.startsWith(this.prefix), 'INVALID_PATH', 'Repository returned a path outside the selected project.');
    return vaultPath(path.slice(this.prefix.length));
  }
}

/**
 * Adapts an observer bound to `directory` to commits of the parent repository: it receives only the changes
 * inside that directory, with paths relative to it, and nothing for batches entirely outside it. A rename that
 * crosses the directory boundary arrives as a deletion (moved out) or a creation (moved in).
 */
export function scopedCommitObserver(observer: CommitObserver, directory: string): CommitObserver {
  const prefix = `${vaultPath(directory)}/`;
  const within = (path: string) => path.startsWith(prefix);
  return {
    async committed({ renames, changes }) {
      const moved: Array<FileRename & { kind: 'file' }> = [], crossed: CommittedChange[] = [];
      for (const rename of renames) {
        if (within(rename.from) && within(rename.to)) moved.push({ ...rename, from: rename.from.slice(prefix.length), to: rename.to.slice(prefix.length) });
        else if (within(rename.from)) crossed.push({ path: rename.from.slice(prefix.length), revision: rename.revision, operation: 'deleted', bytes: rename.bytes });
        else if (within(rename.to)) crossed.push({ path: rename.to.slice(prefix.length), revision: rename.revision, operation: 'created', bytes: rename.bytes });
      }
      const inside = [...crossed, ...changes.filter(change => within(change.path)).map(change => ({ ...change, path: change.path.slice(prefix.length) }))];
      if (moved.length + inside.length > 0) await observer.committed({ renames: moved, changes: inside });
    },
  };
}
