import { type WriteRequest } from './file.ts';
/** Validate untrusted plugin inputs and detach them before asynchronous work. */
export declare function snapshotWriteRequests(writes: readonly WriteRequest[]): WriteRequest[];
/** CONFLICT details: the guarded path, the caller's expected revision and the stored revision, null when the file is absent. */
export type RevisionConflict = {
    path: string;
    expectedRevision: string | null;
    currentRevision: string | null;
};
export declare function revisionConflict(path: string, expectedRevision: string | null | undefined, currentRevision: string | null | undefined): RevisionConflict;
/**
 * The CONFLICT message for one guard that failed, naming the next step for its case: the file exists although the
 * request expected none, the file is missing although the request carries a revision, or its revision changed since
 * it was read. `alreadyApplied` marks a stale guard whose file already holds the requested result.
 */
export declare function conflictMessage(conflict: RevisionConflict, alreadyApplied?: boolean): string;
/** Equal byte sequences: a write of these bytes leaves the file unchanged. */
export declare const sameBytes: (a: Uint8Array, b: Uint8Array) => boolean;
