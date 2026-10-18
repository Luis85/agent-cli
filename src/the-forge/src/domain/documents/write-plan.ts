import { ensure, isRecord } from '../shared/errors.ts';
import { vaultPath, type WriteRequest } from './file.ts';

/** Validate untrusted plugin inputs and detach them before asynchronous work. */
export function snapshotWriteRequests(writes: readonly WriteRequest[]): WriteRequest[] {
  ensure(Array.isArray(writes) && Array.from(writes).every(write => isRecord(write) && typeof write.path === 'string' && write.bytes instanceof Uint8Array && (write.expectedRevision === undefined || typeof write.expectedRevision === 'string')), 'INVALID_PLAN', 'Write plans must contain file requests with Uint8Array bytes.');
  return writes.map(write => ({ path: vaultPath(write.path), bytes: Uint8Array.from(write.bytes), expectedRevision: write.expectedRevision }));
}

/**
 * CONFLICT details: the guarded path, the caller's expected revision and the stored revision, null when the file is
 * absent. An empty expected revision for a present file is no guard at all, so its `reason` is `revision-required`.
 */
export type RevisionConflict = { path: string; expectedRevision: string | null; currentRevision: string | null; reason?: 'revision-required' };
export function revisionConflict(path: string, expectedRevision: string | null | undefined, currentRevision: string | null | undefined): RevisionConflict {
  const unguarded = expectedRevision === '' && typeof currentRevision === 'string';
  return { path, expectedRevision: expectedRevision ?? null, currentRevision: currentRevision ?? null, ...(unguarded ? { reason: 'revision-required' as const } : {}) };
}

/**
 * The CONFLICT message for one guard that failed, naming the next step for its case: the request carries an empty
 * revision, the file exists although the request expected none, the file is missing although the request carries a
 * revision, or its revision changed since it was read. `alreadyApplied` marks a stale guard whose file already holds the requested result.
 */
export function conflictMessage(conflict: RevisionConflict, alreadyApplied = false): string {
  const { path, expectedRevision, currentRevision } = conflict;
  if (conflict.reason === 'revision-required') return `No revision guards ${path}: pass its currentRevision as --if-match (ifMatch in an apply plan) to change or delete it.`;
  if (expectedRevision === null) return `File already exists: ${path}. Replace it with write --if-match and its currentRevision, or change it with edit.`;
  if (currentRevision === null) return `File not found: ${path}; the --if-match revision guards a file that no longer exists. Check the path, or omit --if-match to create it.`;
  if (alreadyApplied) return `File changed since it was read: ${path}, but it already holds the requested change; nothing was written. Continue from its currentRevision.`;
  return `File changed since it was read: ${path}. Read it again, reapply the change to the current content and retry with its currentRevision.`;
}

/** Equal byte sequences: a write of these bytes leaves the file unchanged. */
export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);
