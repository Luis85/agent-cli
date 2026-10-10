import { ensure } from '../../domain/shared/errors.ts';
import { fileKind, type FileChange } from '../../domain/documents/file.ts';
import type { CachedMetadata } from '../../domain/metadata/cache.ts';
import type { Workspace } from '../workspace/workspace.ts';
import type { LinkCounts, MetadataIndex } from '../metadata/ports.ts';
import type { EventChannel } from '../plugins/events.ts';
import type { HostEventMap } from '../plugins/host-events.ts';
import type { ProjectInfo } from '../projects/projects.ts';
import { FileManager } from './file-manager.ts';

/** `ifMatch` guards a mutation with the caller's revision; without it, the revision read just before is used. */
export interface Guard { ifMatch?: string }
type Unsubscribe = () => void;
type VaultEvents = { create: HostEventMap['vault.create']; modify: HostEventMap['vault.modify']; delete: HostEventMap['vault.delete']; rename: HostEventMap['vault.rename'] };
type CacheEvents = { changed: HostEventMap['metadataCache.changed']; deleted: HostEventMap['metadataCache.deleted']; resolve: HostEventMap['metadataCache.resolve']; resolved: HostEventMap['metadataCache.resolved'] };
type WorkspaceEvents = { 'file-open': HostEventMap['workspace.file-open']; 'quick-preview': HostEventMap['workspace.quick-preview']; quit: HostEventMap['workspace.quit']; 'project-change': HostEventMap['workspace.project-change'] };

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
  delete(path: string, options?: Guard & { recursive?: boolean }): ReturnType<FileManager['delete']>;
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
export interface App { vault: VaultFacade; metadataCache: MetadataCacheFacade; fileManager: FileManager; workspace: WorkspaceFacade }
export interface AppScope { workspace: Workspace; metadata: MetadataIndex; events: EventChannel; project: ProjectInfo | null }

const encode = (data: string | Uint8Array) => (typeof data === 'string' ? new TextEncoder().encode(data) : data);
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
const copy = <Value>(value: Value): Value => structuredClone(value);
const listen = (events: EventChannel, prefix: string) => (name: string, callback: (payload: never) => void | Promise<void>): Unsubscribe => {
  ensure(typeof name === 'string', 'INVALID_ARGUMENT', 'Event names are strings.');
  return events.on(`${prefix}.${name}`, callback as (payload: unknown) => void);
};

export function createApp({ workspace, metadata, events, project }: AppScope): App {
  const fileManager = new FileManager(workspace, metadata, { workspace: project === null });
  const revision = async (path: string, options: Guard = {}) => options.ifMatch ?? (await workspace.files.read(path)).revision;
  const single = async (result: Promise<{ changes: FileChange[] }>) => {
    const { path, revision: changed, operation, bytes } = (await result).changes[0]!;
    return { path, revision: changed, operation, bytes };
  };
  const files = async () => (await metadata.load()).files().slice();
  const vault: VaultFacade = {
    read: async path => decode((await workspace.files.read(path)).bytes),
    create: (path, data) => single(workspace.write([{ path, bytes: encode(data) }])),
    modify: async (path, data, options) => single(workspace.write([{ path, bytes: encode(data), expectedRevision: await revision(path, options) }])),
    async process(path, fn, options = {}) {
      const snapshot = await workspace.files.read(path);
      const text = await fn(decode(snapshot.bytes));
      ensure(typeof text === 'string', 'INVALID_ARGUMENT', 'vault.process needs a function returning text.');
      await workspace.edit(path, options.ifMatch ?? snapshot.revision, () => encode(text));
      return text;
    },
    append: async (path, data, options) => single(workspace.edit(path, await revision(path, options), bytes => encode(decode(bytes) + data))),
    trash: (path, options = {}) => fileManager.delete(path, { ...options, recursive: true, allowBrokenLinks: true }),
    delete: (path, options = {}) => fileManager.delete(path, { ...options, permanent: true, allowBrokenLinks: true }),
    rename: (path, newPath, options = {}) => fileManager.move(path, newPath, { ...options, updateLinks: false }),
    getMarkdownFiles: async () => (await files()).filter(path => fileKind(path) === 'markdown'),
    getFiles: files,
    on: listen(events, 'vault') as VaultFacade['on'],
  };
  const metadataCache: MetadataCacheFacade = {
    getFileCache: async path => copy((await metadata.load()).getFileCache(path)),
    getFirstLinkpathDest: async (linkpath, sourcePath) => (await metadata.load()).getFirstLinkpathDest(linkpath, sourcePath),
    fileToLinktext: async (path, sourcePath, omitMdExtension) => (await metadata.load()).fileToLinktext(path, sourcePath, omitMdExtension),
    resolvedLinks: async () => copy((await metadata.load()).resolvedLinks),
    unresolvedLinks: async () => copy((await metadata.load()).unresolvedLinks),
    on: listen(events, 'metadataCache') as MetadataCacheFacade['on'],
  };
  const workspaceFacade: WorkspaceFacade = {
    onLayoutReady: callback => events.onLayoutReady(callback),
    on: listen(events, 'workspace') as WorkspaceFacade['on'],
    getActiveProject: () => (project === null ? null : copy(project)),
  };
  return { vault, metadataCache, fileManager, workspace: workspaceFacade };
}
