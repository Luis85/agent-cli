import type { FileBatch } from './ports.ts';
/** Validate and detach every caller-owned batch request before asynchronous work or notifications. */
export declare function snapshotBatch(batch: FileBatch): Required<FileBatch>;
