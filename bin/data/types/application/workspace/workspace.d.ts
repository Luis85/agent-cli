import { type WriteRequest, type FileChange } from '../../domain/documents/file.ts';
import type { FileRepository, DocumentCodec } from './ports.ts';
import type { EventBus } from '../plugins/events.ts';
export declare class Workspace {
    readonly files: FileRepository;
    readonly codec: DocumentCodec;
    readonly events: EventBus;
    readonly dryRun: boolean;
    readonly root: string | null;
    constructor(files: FileRepository, codec: DocumentCodec, events: EventBus, dryRun: boolean, root?: string | null);
    read(path: string): Promise<{
        path: string;
        revision: string;
        bytes: number;
        document: unknown;
    }>;
    write(writes: readonly WriteRequest[]): Promise<{
        dryRun: boolean;
        changes: FileChange[];
    }>;
    remove(path: string, expectedRevision: string): Promise<{
        dryRun: boolean;
        changes: FileChange[];
    }>;
    private committed;
    edit(path: string, revision: string, transform: (bytes: Uint8Array) => Uint8Array): Promise<{
        dryRun: boolean;
        changes: FileChange[];
    }>;
    private observe;
}
