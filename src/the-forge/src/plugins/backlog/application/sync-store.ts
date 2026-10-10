import type { Workspace } from '../../../application/workspace/workspace.ts';
import type { WriteRequest } from '../../../domain/documents/file.ts';
import { AppError } from '../../../domain/shared/errors.ts';
import { emptyState, parseState, renameEntries, serializeState, statePath, type SyncState } from '../domain/sync-state.ts';

const encoder = new TextEncoder(), decoder = new TextDecoder();

/** A loaded state file with the revision it was read at (null when it does not exist yet). */
export interface StoredState { state: SyncState; revision: string | null; text: string | null }

export async function readState(workspace: Workspace, connection: string): Promise<StoredState> {
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
export function stateWrite(stored: StoredState): WriteRequest | null {
  const text = serializeState(stored.state);
  if (text === stored.text || (stored.text === null && Object.keys(stored.state.items).length === 0)) return null;
  return { path: statePath(stored.state.connection), bytes: encoder.encode(text), ...(stored.revision === null ? {} : { expectedRevision: stored.revision }) };
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
