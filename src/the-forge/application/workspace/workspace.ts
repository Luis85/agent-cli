import { ensure, summarizeError, errorMessage } from '../../domain/shared/errors.ts';
import { isStructured, isTextLike, type WriteRequest, type FileChange, type FileSnapshot, type PlannedChange } from '../../domain/documents/file.ts';
import { revisionConflict, snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import { unifiedDiff } from '../../domain/documents/diff.ts';
import type { FileRepository, DocumentCodec } from './ports.ts';
import type { EventBus } from '../plugins/events.ts';
import { publishHostEvent, type HostEventMap } from '../plugins/host-events.ts';

type Operation = HostEventMap['workspace.started']['operation'];
/** Phase records summarize persistence; preview diffs stay in the command result. */
const changeSummary = (result: { changes: FileChange[] }) => ({
  changes: result.changes.map(({ path, revision, operation, bytes }) => ({ path, revision, operation, bytes })),
  bytes: result.changes.reduce((total, change) => total + change.bytes, 0),
});
/** Dry-run result options; `diff` adds a unified diff to each planned change. */
export interface WriteOptions { diff?: boolean }
const utf8 = (bytes: Uint8Array): string | undefined => {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return undefined; }
};

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
  async write(writes: readonly WriteRequest[], options: WriteOptions = {}) {
    return this.guardedWrite(writes, options.diff === true ? new Map() : undefined);
  }
  /** `previous` enables preview diffs and supplies snapshots the caller already read. */
  private async guardedWrite(writes: readonly WriteRequest[], previous?: ReadonlyMap<string, FileSnapshot>) {
    // Detach caller-owned bytes before the first asynchronous notification.
    let requests: WriteRequest[];
    try { requests = snapshotWriteRequests(writes); }
    catch (error) { return this.observe('write', [], async (): Promise<{ dryRun: boolean; changes: Array<FileChange | PlannedChange> }> => { throw error; }, changeSummary); }
    return this.observe('write', requests.map(request => request.path), async () => {
      for (const write of requests) if (isStructured(write.path)) this.codec.validate(write.path, write.bytes);
      const changes = await this.files.writeBatch(requests, this.dryRun);
      const result = await this.committed(changes);
      return this.dryRun && previous ? { ...result, changes: await this.preview(changes, requests, previous) } : result;
    }, changeSummary);
  }
  /** Diff each planned file against the revision that the dry run checked; binary content has no diff. */
  private async preview(changes: FileChange[], requests: WriteRequest[], previous: ReadonlyMap<string, FileSnapshot>): Promise<PlannedChange[]> {
    return Promise.all(changes.map(async change => {
      const request = requests.find(candidate => candidate.path === change.path);
      const after = request && isTextLike(change.path) ? utf8(request.bytes) : undefined;
      if (after === undefined) return { ...change, diff: null };
      if (change.operation === 'created') return { ...change, diff: unifiedDiff({ path: change.path, before: '', after, created: true }) };
      const snapshot = previous.get(change.path) ?? await this.files.read(change.path);
      const before = snapshot.revision === request!.expectedRevision ? utf8(snapshot.bytes) : undefined;
      return { ...change, diff: before === undefined ? null : unifiedDiff({ path: change.path, before, after }) };
    }));
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
  // Dry-run edits always include a unified diff of the transformed file.
  async edit(path: string, revision: string, transform: (bytes: Uint8Array) => Uint8Array) {
    return this.observe('edit', [path], async () => {
      const file = await this.files.read(path);
      ensure(file.revision === revision, 'CONFLICT', `File changed; read again before editing: ${path}`, revisionConflict(path, revision, file.revision));
      return this.guardedWrite([{ path, bytes: transform(file.bytes), expectedRevision: revision }], new Map([[path, file]]));
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
