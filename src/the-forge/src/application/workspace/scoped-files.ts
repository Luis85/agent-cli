import { ensure } from '../../domain/shared/errors.ts';
import { vaultPath, type FileChange, type FileSnapshot, type WriteRequest } from '../../domain/documents/file.ts';
import { snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import type { FileRepository, WriteBatchResult } from './ports.ts';

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

  private relative(path: string): string {
    ensure(path.startsWith(this.prefix), 'INVALID_PATH', 'Repository returned a path outside the selected project.');
    return vaultPath(path.slice(this.prefix.length));
  }
}
