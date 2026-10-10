import { isRecord } from '../../../domain/shared/errors.ts';
import { backlogError } from './errors.ts';

/**
 * Per connection sync state, kept in the command scope's `.forge/sync/<connection>.json`: for every synced note
 * (keyed by vault path) the remote id, URL and revision, and a hash per field of the value both sides held after
 * the last successful sync. The three-way comparison reads its base from here.
 */
export interface SyncEntry { id: string; url: string; rev: string; fields: Record<string, string> }
export interface SyncState { version: 1; connection: string; items: Record<string, SyncEntry> }

export const statePath = (connection: string) => `.forge/sync/${connection}.json`;
/** The lock file that keeps two syncs of one connection apart. */
export const lockPath = (connection: string) => `.forge/sync/${connection}.lock`;
/** Field base keys with this prefix hold the hash of the remote text as read, where it differs from the note's form (descriptions). */
export const REMOTE_BASE = 'remote:';
/** A stored revision no remote item has: the next sync compares every field again (a remote value is still to land). */
export const UNSETTLED_REV = '0';
export const emptyState = (connection: string): SyncState => ({ version: 1, connection, items: {} });

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Reads a state file; anything unreadable is a configuration problem naming the file, never silently reset. */
export function parseState(source: string, connection: string): SyncState {
  let json: unknown;
  try { json = JSON.parse(source); } catch { json = null; }
  const invalid = () => backlogError('BACKLOG_CONFIG_PROBLEM', `${statePath(connection)} is not a readable sync state; restore it from version control, or delete it to relink notes by their link property (a relink reports differing fields as conflicts and never overwrites either side).`, { path: statePath(connection) });
  if (!isRecord(json) || json.version !== 1 || !isRecord(json.items)) throw invalid();
  const items: Record<string, SyncEntry> = {};
  for (const [path, entry] of Object.entries(json.items)) {
    if (!isRecord(entry) || !text(entry.id) || !text(entry.url) || !text(entry.rev) || !isRecord(entry.fields)) throw invalid();
    items[path] = { id: entry.id, url: entry.url, rev: entry.rev, fields: Object.fromEntries(Object.entries(entry.fields).filter((field): field is [string, string] => typeof field[1] === 'string')) };
  }
  return { version: 1, connection, items };
}

/** Deterministic JSON: items by path, fields by name. */
export function serializeState(state: SyncState): string {
  const items = Object.fromEntries(Object.keys(state.items).sort().map(path => {
    const entry = state.items[path]!;
    return [path, { id: entry.id, url: entry.url, rev: entry.rev, fields: Object.fromEntries(Object.keys(entry.fields).sort().map(field => [field, entry.fields[field]])) }];
  }));
  return `${JSON.stringify({ version: 1, connection: state.connection, items }, null, 2)}\n`;
}

/** Moves entries for a renamed note, or for every note below a renamed folder. Returns whether anything moved. */
export function renameEntries(state: SyncState, from: string, to: string, kind: 'file' | 'folder'): boolean {
  let moved = false;
  for (const path of Object.keys(state.items)) {
    const target = kind === 'file' ? (path === from ? to : null) : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
    if (target === null) continue;
    state.items[target] = state.items[path]!;
    delete state.items[path];
    moved = true;
  }
  return moved;
}

/** The note path whose entry holds a remote id. */
export function pathOfRemote(state: SyncState, id: string): string | null {
  return Object.entries(state.items).find(([, entry]) => entry.id === id)?.[0] ?? null;
}
