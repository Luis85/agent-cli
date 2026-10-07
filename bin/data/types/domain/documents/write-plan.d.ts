import { type WriteRequest } from './file.ts';
/** Validate untrusted plugin inputs and detach them before asynchronous work. */
export declare function snapshotWriteRequests(writes: readonly WriteRequest[]): WriteRequest[];
