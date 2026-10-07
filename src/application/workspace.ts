import { ensure } from '../domain/errors.ts';
import { isStructured, type WriteRequest } from '../domain/file.ts';
import type { FileRepository, DocumentCodec } from './ports.ts';
import type { EventBus } from './events.ts';

export class Workspace {
  constructor(readonly files: FileRepository, readonly codec: DocumentCodec, readonly events: EventBus, readonly dryRun: boolean) {}
  async read(path: string) {
    const file = await this.files.read(path);
    return { path, revision: file.revision, bytes: file.bytes.length, document: this.codec.inspect(path, file.bytes) };
  }
  async write(writes: readonly WriteRequest[]) {
    for (const write of writes) if (isStructured(write.path)) this.codec.validate(write.path, write.bytes);
    const changes = await this.files.writeBatch(writes, this.dryRun);
    if (!this.dryRun) for (const change of changes) await this.events.emit(`file.${change.operation}`, change);
    return { dryRun: this.dryRun, changes };
  }
  async edit(path: string, revision: string, transform: (bytes: Uint8Array) => Uint8Array) {
    const file = await this.files.read(path);
    ensure(file.revision === revision, 'CONFLICT', 'File changed; read again before editing.');
    return this.write([{ path, bytes: transform(file.bytes), expectedRevision: revision }]);
  }
}
