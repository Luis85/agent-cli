import { ensure, summarizeError, errorMessage } from '../../domain/shared/errors.ts';
import { isInTrash, isStructured, isTextLike, type WriteRequest, type FileChange, type FileRename, type FileSnapshot, type PlannedChange } from '../../domain/documents/file.ts';
import { revisionConflict, snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import { unifiedDiff } from '../../domain/documents/diff.ts';
import type { FileRepository, DocumentCodec, CommitObserver, FileBatch, BatchResult } from './ports.ts';
import type { EventBus } from '../plugins/events.ts';
import { publishHostEvent, type HostEventMap } from '../plugins/host-events.ts';

type Operation = HostEventMap['operation.started']['operation'];
const vaultEvents = { created: 'vault.create', updated: 'vault.modify', deleted: 'vault.delete' } as const;
/** Phase records summarize persistence; preview diffs stay in the command result. */
const changeSummary = (result: { changes: FileChange[]; renames?: FileRename[] }) => ({
  changes: result.changes.map(({ path, revision, operation, bytes }) => ({ path, revision, operation, bytes })),
  bytes: result.changes.reduce((total, change) => total + change.bytes, 0),
  ...(result.renames ? { renames: result.renames.map(({ from, to, kind }) => ({ from, to, kind })) } : {}),
});
/** Dry-run result options; `diff` adds a unified diff to each planned change. */
export interface WriteOptions { diff?: boolean }
/**
 * How a mixed batch is reported. `trash` lists trash destinations: renames to or into them are reported as
 * deletions, because they move files into the hidden `.trash` folder, and no records are published for folders the
 * batch creates in `.trash`. `previous` holds the snapshots a dry run diffs each write against, keyed by the written
 * path; without it dry runs carry no diffs.
 */
export interface CommitOptions { operation: 'move' | 'delete' | 'apply'; trash?: readonly string[]; previous?: ReadonlyMap<string, FileSnapshot> }
const into = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
const utf8 = (bytes: Uint8Array): string | undefined => {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return undefined; }
};

export class Workspace {
  /** `observer` follows each committed batch of this scope, such as the metadata cache of the same root. */
  constructor(
    readonly files: FileRepository, readonly codec: DocumentCodec, private readonly events: EventBus, readonly dryRun: boolean,
    readonly root: string | null = null, private readonly observer?: CommitObserver,
  ) {}
  /**
   * The same invocation (events, codec, dry run) over another repository scope, such as a selected project.
   * Commit observers are bound to one scope, so the new scope has only the `observer` given here.
   */
  within(files: FileRepository, root: string | null, observer?: CommitObserver): Workspace {
    return new Workspace(files, this.codec, this.events, this.dryRun, root, observer);
  }
  // CLI handlers and external plugins call this through the typed CommandContext workspace.
  // A successful read is Obsidian's file-open: it emits `workspace.file-open` with the scoped path.
  async read(path: string) {
    return this.observe('read', [path], async () => {
      const file = await this.files.read(path);
      const result = { path, revision: file.revision, bytes: file.bytes.length, document: this.codec.inspect(path, file.bytes) };
      await publishHostEvent(this.events, 'workspace.file-open', { path });
      return result;
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
      const { changes, folders } = await this.files.writeBatch(requests, this.dryRun);
      await this.committed({ renames: [], changes, folders, removedFolders: [] });
      return { dryRun: this.dryRun, changes: this.dryRun && previous ? await this.preview(changes, requests, previous) : changes };
    }, changeSummary);
  }
  /** Diff each planned file against the revision that the dry run checked; binary content has no diff. */
  private async preview(changes: FileChange[], requests: WriteRequest[], previous: ReadonlyMap<string, FileSnapshot>): Promise<PlannedChange[]> {
    return Promise.all(changes.map(async change => {
      const request = requests.find(candidate => candidate.path === change.path);
      const after = request && isTextLike(change.path) ? utf8(request.bytes) : undefined;
      if (after === undefined || change.operation === 'deleted') return { ...change, diff: null };
      if (change.operation === 'created') return { ...change, diff: unifiedDiff({ path: change.path, before: '', after, created: true }) };
      const snapshot = previous.get(change.path) ?? await this.files.read(change.path);
      const before = snapshot.revision === request!.expectedRevision ? utf8(snapshot.bytes) : undefined;
      return { ...change, diff: before === undefined ? null : unifiedDiff({ path: change.path, before, after }) };
    }));
  }
  async remove(path: string, expectedRevision: string) {
    return this.observe('remove', [path], async () => {
      const change = await this.files.remove(path, expectedRevision, this.dryRun);
      await this.committed({ renames: [], changes: [change], folders: [], removedFolders: [] });
      return { dryRun: this.dryRun, changes: [change] };
    }, changeSummary);
  }
  /**
   * One guarded batch of renames, writes and removals (see `FileRepository.commit`). Structured writes are
   * validated first; dry runs return each write's diff when `options.previous` is given.
   */
  async commit(batch: FileBatch, options: CommitOptions) {
    const paths = [...(batch.renames ?? []).flatMap(rename => [rename.from, rename.to]), ...(batch.writes ?? []).map(write => write.path), ...(batch.removes ?? []).map(remove => remove.path)];
    return this.observe(options.operation, paths, async () => {
      const requests = snapshotWriteRequests(batch.writes ?? []);
      for (const write of requests) if (isStructured(write.path)) this.codec.validate(write.path, write.bytes);
      const result = await this.files.commit({ ...batch, writes: requests }, this.dryRun);
      await this.committed(result, options.trash ?? []);
      const changes = this.dryRun && options.previous ? await this.preview(result.changes, requests, options.previous) : result.changes;
      return { dryRun: this.dryRun, renames: result.renames, changes, folders: result.folders, removedFolders: result.removedFolders };
    }, changeSummary);
  }
  /**
   * Dry runs emit one `workspace.quick-preview` per planned file change. Commits emit `vault.create` for each new
   * folder (parent before child), one `vault.rename` per moved folder or file, one `vault.*` record per file change
   * in batch order, then `vault.delete` per removed folder (child before parent), and finally run the commit
   * observer. Renames into a `trash` destination are reported after the other renames: each moved file, then each
   * moved folder (child before parent), as `vault.delete`.
   */
  private async committed(result: BatchResult, trash: readonly string[] = []): Promise<void> {
    const { renames, changes, folders, removedFolders } = result;
    if (this.dryRun) {
      for (const { path, operation, bytes } of changes) await publishHostEvent(this.events, 'workspace.quick-preview', { path, operation, bytes });
      return;
    }
    const trashed = (rename: FileRename) => trash.some(destination => into(rename.to, destination));
    for (const path of folders) if (!(trash.length > 0 && isInTrash(path))) await this.notify(path, 'vault.create', { path, kind: 'folder', operation: 'created' });
    for (const rename of renames) if (!trashed(rename)) await this.notify(rename.to, 'vault.rename', { path: rename.to, oldPath: rename.from, kind: rename.kind, ...(rename.kind === 'file' ? { revision: rename.revision } : {}) });
    for (const rename of renames) if (trashed(rename) && rename.kind === 'file') await this.notify(rename.from, 'vault.delete', { path: rename.from, kind: 'file', revision: rename.revision, bytes: rename.bytes, operation: 'deleted' });
    for (const rename of [...renames].reverse()) if (trashed(rename) && rename.kind === 'folder') await this.notify(rename.from, 'vault.delete', { path: rename.from, kind: 'folder', operation: 'deleted' });
    for (const { path, revision, operation, bytes } of changes) await this.notify(path, vaultEvents[operation], { path, kind: 'file', revision, bytes, operation });
    for (const path of removedFolders) await this.notify(path, 'vault.delete', { path, kind: 'folder', operation: 'deleted' });
    const moved = renames.filter((rename): rename is FileRename & { kind: 'file' } => rename.kind === 'file');
    if (this.observer && moved.length + changes.length > 0) {
      try { await this.observer.committed({ renames: moved, changes }); }
      catch (error) { this.warn(`Committed ${moved.length + changes.length} file(s); post-commit update failed: ${errorMessage(error)}`); }
    }
  }
  private async notify(path: string, id: string, payload: unknown): Promise<void> {
    try { await this.events.emit(id, payload); }
    catch (error) { this.warn(`Committed ${path}; vault notification failed: ${errorMessage(error)}`); }
  }
  private warn(message: string): void {
    try { this.events.warn(message); }
    catch { /* A failed diagnostic sink cannot turn committed persistence into failure. */ }
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
    await publishHostEvent(this.events, 'operation.started', payload);
    try {
      const result = await action();
      await publishHostEvent(this.events, 'operation.succeeded', { ...payload, ...summarize(result) });
      return result;
    } catch (error) {
      await publishHostEvent(this.events, 'operation.failed', { ...payload, error: summarizeError(error) });
      throw error;
    }
  }
}
