import { ensure, isRecord } from '../domain/errors.ts';
import { isStructured, type WriteRequest } from '../domain/file.ts';
import type { FileRepository, DocumentCodec } from './ports.ts';
import type { EventBus } from './events.ts';

export class Workspace {
  constructor(readonly files: FileRepository, readonly codec: DocumentCodec, readonly events: EventBus, readonly dryRun: boolean) {}
  // CLI handlers and external plugins call this through the typed CommandContext workspace.
  // fallow-ignore-next-line unused-class-member
  async read(path: string) {
    const file = await this.files.read(path);
    return { path, revision: file.revision, bytes: file.bytes.length, document: this.codec.inspect(path, file.bytes) };
  }
  async write(writes: readonly WriteRequest[]) {
    ensure(Array.isArray(writes) && Array.from(writes).every(write => isRecord(write) && typeof write.path === 'string' && write.bytes instanceof Uint8Array && (write.expectedRevision === undefined || typeof write.expectedRevision === 'string')), 'INVALID_PLAN', 'Write plans must contain file requests with Uint8Array bytes.');
    for (const write of writes) if (isStructured(write.path)) this.codec.validate(write.path, write.bytes);
    const changes = await this.files.writeBatch(writes, this.dryRun);
    if (!this.dryRun) for (const change of changes) {
      try { await this.events.emit(`file.${change.operation}`, change); }
      catch (error) { this.events.warn(`Committed ${change.path}; file notification failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return { dryRun: this.dryRun, changes };
  }
  // CLI handlers and external plugins use this guarded editing API through CommandContext.
  // fallow-ignore-next-line unused-class-member
  async edit(path: string, revision: string, transform: (bytes: Uint8Array) => Uint8Array) {
    const file = await this.files.read(path);
    ensure(file.revision === revision, 'CONFLICT', 'File changed; read again before editing.');
    return this.write([{ path, bytes: transform(file.bytes), expectedRevision: revision }]);
  }
}
