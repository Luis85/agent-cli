import { ensure, isRecord } from '../shared/errors.ts';
import { vaultPath, type WriteRequest } from './file.ts';

/** Validate untrusted plugin inputs and detach them before asynchronous work. */
export function snapshotWriteRequests(writes: readonly WriteRequest[]): WriteRequest[] {
  ensure(Array.isArray(writes) && Array.from(writes).every(write => isRecord(write) && typeof write.path === 'string' && write.bytes instanceof Uint8Array && (write.expectedRevision === undefined || typeof write.expectedRevision === 'string')), 'INVALID_PLAN', 'Write plans must contain file requests with Uint8Array bytes.');
  return writes.map(write => ({ path: vaultPath(write.path), bytes: Uint8Array.from(write.bytes), expectedRevision: write.expectedRevision }));
}
