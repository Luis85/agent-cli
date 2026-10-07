import { ensure } from '../domain/errors.ts';
import { vaultPath, type FileChange, type FileSnapshot, type WriteRequest } from '../domain/file.ts';
import { snapshotWriteRequests } from '../domain/write-plan.ts';
import type { FileRepository } from './ports.ts';

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

  async writeBatch(writes: readonly WriteRequest[], dryRun: boolean): Promise<FileChange[]> {
    const requests = snapshotWriteRequests(writes).map(write => ({ ...write, path: this.prefix + write.path }));
    const changes = await this.files.writeBatch(requests, dryRun);
    return changes.map(change => ({ ...change, path: this.relative(change.path) }));
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
