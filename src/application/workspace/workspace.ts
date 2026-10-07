import { ensure, summarizeError, errorMessage } from '../../domain/shared/errors.ts';
import { isStructured, type WriteRequest, type FileChange } from '../../domain/documents/file.ts';
import { snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import type { FileRepository, DocumentCodec } from './ports.ts';
import type { EventBus } from '../plugins/events.ts';
import { publishHostEvent, type HostEventMap } from '../plugins/host-events.ts';

type Operation = HostEventMap['workspace.started']['operation'];
const changeSummary = (result: { changes: FileChange[] }) => ({ changes: result.changes, bytes: result.changes.reduce((total, change) => total + change.bytes, 0) });

export class Workspace {
  constructor(readonly files: FileRepository, readonly codec: DocumentCodec, readonly events: EventBus, readonly dryRun: boolean, readonly root: string | null = null) {}
  // CLI handlers and external plugins call this through the typed CommandContext workspace.
  // fallow-ignore-next-line unused-class-member
  async read(path: string) {
    return this.observe('read', [path], async () => {
      const file = await this.files.read(path);
      return { path, revision: file.revision, bytes: file.bytes.length, document: this.codec.inspect(path, file.bytes) };
    }, result => ({ bytes: result.bytes }));
  }
  async write(writes: readonly WriteRequest[]) {
    // Detach caller-owned bytes before the first asynchronous notification.
    let requests: WriteRequest[];
    try { requests = snapshotWriteRequests(writes); }
    catch (error) { return this.observe('write', [], async (): Promise<{ dryRun: boolean; changes: FileChange[] }> => { throw error; }, changeSummary); }
    return this.observe('write', requests.map(request => request.path), async () => {
      for (const write of requests) if (isStructured(write.path)) this.codec.validate(write.path, write.bytes);
      const changes = await this.files.writeBatch(requests, this.dryRun);
      return this.committed(changes);
    }, changeSummary);
  }
  async remove(path: string, expectedRevision: string) {
    return this.observe('remove', [path], async () => {
      const change = await this.files.remove(path, expectedRevision, this.dryRun);
      return this.committed([change]);
    }, changeSummary);
  }
  private async committed(changes: FileChange[]) {
    if (!this.dryRun) for (const change of changes) {
      try { await this.events.emit(`file.${change.operation}`, change); }
      catch (error) {
        try { this.events.warn(`Committed ${change.path}; file notification failed: ${errorMessage(error)}`); }
        catch { /* A failed diagnostic sink cannot turn committed persistence into failure. */ }
      }
    }
    return { dryRun: this.dryRun, changes };
  }
  // CLI handlers and external plugins use this guarded editing API through CommandContext.
  async edit(path: string, revision: string, transform: (bytes: Uint8Array) => Uint8Array) {
    return this.observe('edit', [path], async () => {
      const file = await this.files.read(path);
      ensure(file.revision === revision, 'CONFLICT', 'File changed; read again before editing.');
      return this.write([{ path, bytes: transform(file.bytes), expectedRevision: revision }]);
    }, changeSummary);
  }
  private async observe<T>(operation: Operation, paths: string[], action: () => Promise<T>, summarize: (result: T) => { changes?: FileChange[]; bytes?: number }) {
    const payload = { operationId: this.events.nextOperationId(), operation, root: this.root, paths: paths.filter(path => typeof path === 'string' && path.length > 0), dryRun: this.dryRun };
    await publishHostEvent(this.events, 'workspace.started', payload);
    try {
      const result = await action();
      await publishHostEvent(this.events, 'workspace.succeeded', { ...payload, ...summarize(result) });
      return result;
    } catch (error) {
      await publishHostEvent(this.events, 'workspace.failed', { ...payload, error: summarizeError(error) });
      throw error;
    }
  }
}
