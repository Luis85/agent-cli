import { type WriteRequest } from '../domain/file.ts';
import type { FileRepository, DocumentCodec } from './ports.ts';
import type { EventBus } from './events.ts';
export declare class Workspace {
    readonly files: FileRepository;
    readonly codec: DocumentCodec;
    readonly events: EventBus;
    readonly dryRun: boolean;
    constructor(files: FileRepository, codec: DocumentCodec, events: EventBus, dryRun: boolean);
    read(path: string): Promise<{
        path: string;
        revision: string;
        bytes: number;
        document: unknown;
    }>;
    write(writes: readonly WriteRequest[]): Promise<{
        dryRun: boolean;
        changes: import("../sdk.ts").FileChange[];
    }>;
    edit(path: string, revision: string, transform: (bytes: Uint8Array) => Uint8Array): Promise<{
        dryRun: boolean;
        changes: import("../sdk.ts").FileChange[];
    }>;
}
