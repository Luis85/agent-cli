import type { Workspace } from '../../../application/workspace/workspace.ts';
import type { FileChange, WriteRequest } from '../../../domain/documents/file.ts';
import { AppError } from '../../../domain/shared/errors.ts';
import { emptyState, parseState, renameEntries, serializeState, statePath, type SyncEntry, type SyncState } from '../domain/sync-state.ts';

const encoder = new TextEncoder(), decoder = new TextDecoder();
/** Attempts of a state write that meets a concurrent writer: each one re-reads the file and re-applies this run's changes. */
const SAVE_ATTEMPTS = 3;

/** A loaded state file with the revision it was read at (null when it does not exist yet). */
interface StoredState { state: SyncState; revision: string | null; text: string | null }

async function readState(workspace: Workspace, connection: string): Promise<StoredState> {
  try {
    const snapshot = await workspace.files.read(statePath(connection));
    const text = decoder.decode(snapshot.bytes);
    return { state: parseState(text, connection), revision: snapshot.revision, text };
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return { state: emptyState(connection), revision: null, text: null };
    throw error;
  }
}

/** The guarded write of a changed state file, or null when its text is unchanged (an empty state is not created). */
function stateWrite(stored: StoredState): WriteRequest | null {
  const text = serializeState(stored.state);
  if (text === stored.text || (stored.text === null && Object.keys(stored.state.items).length === 0)) return null;
  return { path: statePath(stored.state.connection), bytes: encoder.encode(text), ...(stored.revision === null ? {} : { expectedRevision: stored.revision }) };
}

/** Whether a revision conflict concerns this path. */
export const conflictOn = (error: unknown, path: string) => error instanceof AppError && error.code === 'CONFLICT' && error.details?.path === path;

/**
 * One sync run's view of a connection's state file. The run records what it changes (entries set and removed), so
 * when another writer changed the file meanwhile (a note moved through Forge in another process), `refresh` re-reads
 * it and re-applies the run's changes instead of overwriting the other writer's or failing the run.
 */
export class SyncStore {
  private readonly sets = new Map<string, SyncEntry>();
  private readonly removed = new Set<string>();

  private constructor(private readonly workspace: Workspace, private stored: StoredState) {}

  static async open(workspace: Workspace, connection: string): Promise<SyncStore> {
    return new SyncStore(workspace, await readState(workspace, connection));
  }

  get state(): SyncState { return this.stored.state; }
  get path(): string { return statePath(this.stored.state.connection); }

  set(path: string, entry: SyncEntry): void {
    this.stored.state.items[path] = entry;
    this.sets.set(path, entry);
    this.removed.delete(path);
  }

  remove(path: string): void {
    delete this.stored.state.items[path];
    this.sets.delete(path);
    this.removed.add(path);
  }

  /** The guarded state write for a batch, or null when nothing changed. */
  request(): WriteRequest | null { return stateWrite(this.stored); }

  /** Takes in the revision a committed batch gave the state file. */
  committed(changes: readonly FileChange[]): void {
    const change = changes.find(entry => entry.path === this.path);
    if (change) this.stored = { state: this.stored.state, revision: change.revision, text: serializeState(this.stored.state) };
  }

  /** Re-reads the file and re-applies this run's changes on top of what another writer left. */
  async refresh(): Promise<void> {
    const fresh = await readState(this.workspace, this.stored.state.connection);
    for (const path of this.removed) delete fresh.state.items[path];
    for (const [path, entry] of this.sets) fresh.state.items[path] = entry;
    this.stored = fresh;
  }

  /**
   * Writes the state file alone, right away (dry runs write nothing). A revision conflict re-reads the file and
   * retries against the fresh revision, so ids recorded here survive a concurrent writer.
   */
  async save(): Promise<void> {
    if (this.workspace.dryRun) return;
    for (let attempt = 1; ; attempt++) {
      const request = this.request();
      if (request === null) return;
      try { this.committed((await this.workspace.write([request])).changes); return; }
      catch (error) {
        if (attempt >= SAVE_ATTEMPTS || !conflictOn(error, this.path)) throw error;
        await this.refresh();
      }
    }
  }
}

/** Whether a sync of this plugin is running; its own renames update the state it holds, not the files. */
export interface SyncActivity { syncing: boolean }

/**
 * Keeps state files keyed by note path when notes or folders are renamed through Forge (`vault.rename`): each
 * connection's state file in the scope moves the affected entries in one guarded write. Notes renamed outside Forge
 * are relinked by their link property on the next sync.
 */
export async function followRename(workspace: Workspace, connections: readonly string[], oldPath: string, path: string, kind: 'file' | 'folder'): Promise<void> {
  for (const connection of connections) {
    const stored = await readState(workspace, connection);
    if (stored.revision === null || !renameEntries(stored.state, oldPath, path, kind)) continue;
    const request = stateWrite(stored);
    if (request) await workspace.write([request]);
  }
}
