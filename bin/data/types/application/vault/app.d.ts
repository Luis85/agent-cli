import { type FileChange } from '../../domain/documents/file.ts';
import type { CachedMetadata } from '../../domain/metadata/cache.ts';
import type { Workspace } from '../workspace/workspace.ts';
import type { LinkCounts, MetadataIndex } from '../metadata/ports.ts';
import type { EventChannel } from '../plugins/events.ts';
import type { HostEventMap } from '../plugins/host-events.ts';
import type { ProjectInfo } from '../projects/projects.ts';
import { FileManager } from './file-manager.ts';
/** `ifMatch` guards a mutation with the caller's revision; without it, the revision read just before is used. */
export interface Guard {
    ifMatch?: string;
}
type Unsubscribe = () => void;
type VaultEvents = {
    create: HostEventMap['vault.create'];
    modify: HostEventMap['vault.modify'];
    delete: HostEventMap['vault.delete'];
    rename: HostEventMap['vault.rename'];
};
type CacheEvents = {
    changed: HostEventMap['metadataCache.changed'];
    deleted: HostEventMap['metadataCache.deleted'];
    resolve: HostEventMap['metadataCache.resolve'];
    resolved: HostEventMap['metadataCache.resolved'];
};
type WorkspaceEvents = {
    'file-open': HostEventMap['workspace.file-open'];
    'quick-preview': HostEventMap['workspace.quick-preview'];
    quit: HostEventMap['workspace.quit'];
    'project-change': HostEventMap['workspace.project-change'];
};
/**
 * Obsidian's `Vault` over the command's scope. Paths replace `TFile` objects, and every mutation is a guarded
 * Workspace write, so dry runs, revision guards and `vault.*` records match the CLI. Like Obsidian, `rename`
 * does not update links and `trash`/`delete` do not check them; use `app.fileManager` for that.
 */
export interface VaultFacade {
    /** UTF-8 text of a file. */
    read(path: string): Promise<string>;
    /** Creates a new file; an existing file is a CONFLICT. */
    create(path: string, data: string | Uint8Array): Promise<FileChange>;
    modify(path: string, data: string | Uint8Array, options?: Guard): Promise<FileChange>;
    /** Atomic read-modify-write of UTF-8 text; returns the new text. */
    process(path: string, fn: (data: string) => string | Promise<string>, options?: Guard): Promise<string>;
    append(path: string, data: string, options?: Guard): Promise<FileChange>;
    trash(path: string, options?: Guard): ReturnType<FileManager['delete']>;
    delete(path: string, options?: Guard & {
        recursive?: boolean;
    }): ReturnType<FileManager['delete']>;
    rename(path: string, newPath: string, options?: Guard): ReturnType<FileManager['move']>;
    /** Visible Markdown files in path order, as the metadata cache indexes them. */
    getMarkdownFiles(): Promise<string[]>;
    /** Visible files in path order; dot-prefixed files and folders such as `.obsidian` and `.trash` are omitted. */
    getFiles(): Promise<string[]>;
    on<Name extends keyof VaultEvents>(name: Name, callback: (payload: VaultEvents[Name]) => void | Promise<void>): Unsubscribe;
}
/** Obsidian's `MetadataCache`. The cache is built lazily per invocation, so its accessors return promises. */
export interface MetadataCacheFacade {
    getFileCache(path: string): Promise<CachedMetadata | null>;
    getFirstLinkpathDest(linkpath: string, sourcePath: string): Promise<string | null>;
    fileToLinktext(path: string, sourcePath: string, omitMdExtension?: boolean): Promise<string>;
    resolvedLinks(): Promise<LinkCounts>;
    unresolvedLinks(): Promise<LinkCounts>;
    on<Name extends keyof CacheEvents>(name: Name, callback: (payload: CacheEvents[Name]) => void | Promise<void>): Unsubscribe;
}
/** Obsidian's `Workspace` analogues for a headless invocation. */
export interface WorkspaceFacade {
    onLayoutReady(callback: () => void | Promise<void>): void;
    on<Name extends keyof WorkspaceEvents>(name: Name, callback: (payload: WorkspaceEvents[Name]) => void | Promise<void>): Unsubscribe;
    /** The project this command runs in, or null at workspace scope. */
    getActiveProject(): ProjectInfo | null;
}
/** The Obsidian-shaped `app` of a command or plugin context. */
export interface App {
    vault: VaultFacade;
    metadataCache: MetadataCacheFacade;
    fileManager: FileManager;
    workspace: WorkspaceFacade;
}
export interface AppScope {
    workspace: Workspace;
    metadata: MetadataIndex;
    events: EventChannel;
    project: ProjectInfo | null;
}
export declare function createApp({ workspace, metadata, events, project }: AppScope): App;
export {};
