import { ensure, isRecord } from '../domain/errors.ts';
import { vaultPath, type FileChange, type FileSnapshot, type WriteRequest } from '../domain/file.ts';
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
    ensure(Array.isArray(writes) && Array.from(writes).every(write => isRecord(write) && typeof write.path === 'string' && write.bytes instanceof Uint8Array && (write.expectedRevision === undefined || typeof write.expectedRevision === 'string')), 'INVALID_PLAN', 'Write plans must contain file requests with Uint8Array bytes.');
    // The caller can retain and mutate a plan while the underlying port awaits I/O.
    const requests = writes.map(write => ({ path: this.prefix + vaultPath(write.path), bytes: Uint8Array.from(write.bytes), expectedRevision: write.expectedRevision }));
    const changes = await this.files.writeBatch(requests, dryRun);
    return changes.map(change => ({ ...change, path: this.relative(change.path) }));
  }

  private relative(path: string): string {
    ensure(path.startsWith(this.prefix), 'INVALID_PATH', 'Repository returned a path outside the selected project.');
    return vaultPath(path.slice(this.prefix.length));
  }
}
