import { ensure } from '../../domain/shared/errors.ts';
import { vaultPath, type FileChange, type FileRename, type FileSnapshot, type FileStat, type WriteRequest } from '../../domain/documents/file.ts';
import { snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import type { BatchResult, CommitObserver, FileBatch, FileRepository, WriteBatchResult } from './ports.ts';

/** Project-relative paths with the parent repository's lock and filesystem guards. */
export class ScopedFiles implements FileRepository {
  private readonly prefix: string;

  constructor(private readonly files: FileRepository, directory: string) {
    this.prefix = `${vaultPath(directory)}/`;
  }

  async read(path: string): Promise<FileSnapshot> {
    const relative = vaultPath(path);
    return { ...await this.files.read(this.prefix + relative), path: relative };
  }

  async list(): Promise<string[]> {
    return (await this.files.list()).filter(path => path.startsWith(this.prefix)).map(path => this.relative(path));
  }

  /** Folders created above the project directory are outside this scope and are not reported. */
  async writeBatch(writes: readonly WriteRequest[], dryRun: boolean): Promise<WriteBatchResult> {
    const requests = snapshotWriteRequests(writes).map(write => ({ ...write, path: this.prefix + write.path }));
    const { changes, folders } = await this.files.writeBatch(requests, dryRun);
    return {
      changes: changes.map(change => ({ ...change, path: this.relative(change.path) })),
      folders: folders.filter(folder => folder.startsWith(this.prefix)).map(folder => this.relative(folder)),
    };
  }

  async remove(path: string, expectedRevision: string, dryRun: boolean): Promise<FileChange> {
    const change = await this.files.remove(this.prefix + vaultPath(path), expectedRevision, dryRun);
    return { ...change, path: this.relative(change.path) };
  }

  async stat(path: string): Promise<FileStat> {
    return { ...await this.files.stat(this.prefix + vaultPath(path)), path: vaultPath(path) };
  }

  /** Folders created or removed above the project directory are outside this scope and are not reported. */
  async commit(batch: FileBatch, dryRun: boolean): Promise<BatchResult> {
    const result = await this.files.commit({
      renames: (batch.renames ?? []).map(rename => ({ ...rename, from: this.prefix + vaultPath(rename.from), to: this.prefix + vaultPath(rename.to) })),
      writes: snapshotWriteRequests(batch.writes ?? []).map(write => ({ ...write, path: this.prefix + write.path })),
      removes: (batch.removes ?? []).map(remove => ({ ...remove, path: this.prefix + vaultPath(remove.path) })),
    }, dryRun);
    const inScope = (folders: string[]) => folders.filter(folder => folder.startsWith(this.prefix)).map(folder => this.relative(folder));
    return {
      renames: result.renames.map(rename => ({ ...rename, from: this.relative(rename.from), to: this.relative(rename.to) })),
      changes: result.changes.map(change => ({ ...change, path: this.relative(change.path) })),
      folders: inScope(result.folders),
      removedFolders: inScope(result.removedFolders),
    };
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
      const moved: Array<FileRename & { kind: 'file' }> = [], crossed: FileChange[] = [];
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
