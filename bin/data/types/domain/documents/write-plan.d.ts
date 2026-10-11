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
