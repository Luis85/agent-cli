import { ensure, isRecord } from '../../domain/shared/errors.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import { snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import type { FileBatch } from './ports.ts';

/** Validate and detach every caller-owned batch request before asynchronous work or notifications. */
export function snapshotBatch(batch: FileBatch): Required<FileBatch> {
  ensure(batch !== null && typeof batch === 'object', 'INVALID_PLAN', 'A batch must be an object.');
  const guards = batch.guards ?? [], renames = batch.renames ?? [], removes = batch.removes ?? [];
  const valid = (request: unknown, keys: string[]) => isRecord(request) && keys.every(key => typeof request[key] === 'string');
  ensure(Array.isArray(renames) && Array.from(renames).every(request => valid(request, ['from', 'to', 'expectedRevision'])), 'INVALID_PLAN', 'Renames need from, to and expectedRevision strings.');
  ensure(Array.isArray(removes) && Array.from(removes).every(request => valid(request, ['path', 'expectedRevision'])), 'INVALID_PLAN', 'Removals need path and expectedRevision strings.');
  ensure(Array.isArray(guards) && Array.from(guards).every(request => valid(request, ['path']) && (request.expectedRevision === undefined || typeof request.expectedRevision === 'string')), 'INVALID_PLAN', 'Guards need a path string and an optional expectedRevision string.');
  return {
    guards: guards.map(request => ({ path: vaultPath(request.path), expectedRevision: request.expectedRevision })),
    renames: renames.map(request => ({ from: vaultPath(request.from), to: vaultPath(request.to), expectedRevision: request.expectedRevision })),
    writes: snapshotWriteRequests(batch.writes ?? []),
    removes: removes.map(request => ({ path: vaultPath(request.path), expectedRevision: request.expectedRevision })),
  };
}
