import type { BatchResult, FileRepository, WriteBatchResult } from '../../src/application/workspace/ports.ts';
import type { MetadataCache } from '../../src/application/metadata/ports.ts';
import { VaultMetadata } from '../../src/application/metadata/vault-metadata.ts';
import type { EventChannel } from '../../src/application/plugins/events.ts';
import type { Workspace } from '../../src/application/workspace/workspace.ts';
import { createApp, type App } from '../../src/application/vault/app.ts';
import type { FileChange, FileStat } from '../../src/domain/documents/file.ts';
import { forgeError } from '../../src/domain/shared/errors.ts';
import { NodeBasesQueryEngine } from '../../src/infrastructure/bases/engine.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { ObsidianMetadataParser } from '../../src/infrastructure/metadata/parser.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';

/** The composed kernel metadata index over a repository, as `main.ts` binds it. */
export function metadataIndex(files: FileRepository): VaultMetadata {
  return new VaultMetadata(files, new ObsidianMetadataParser(new ObsidianDocuments()));
}

/** The scope services of a command context, as `main.ts` binds them: the metadata index and the `app` facade over the workspace. */
export function scopeServices(workspace: Workspace, events: EventChannel): { metadata: VaultMetadata; app: App } {
  const metadata = metadataIndex(workspace.files);
  return { metadata, app: createApp({ workspace, metadata, events, project: null }) };
}

/** A Bases engine whose every query loads a fresh metadata cache, so tests may change files between queries. */
export async function basesEngine(root: string): Promise<NodeBasesQueryEngine> {
  const files = await NodeFiles.at(root);
  return new NodeBasesQueryEngine(files, new ObsidianDocuments(), () => metadataIndex(files).load());
}

/** An in-memory, read-only repository of UTF-8 files for isolated metadata tests; tests change `files` directly. */
export class MemoryFiles implements FileRepository {
  readonly files: Map<string, string>;
  constructor(files: Record<string, string>) { this.files = new Map(Object.entries(files)); }
  async read(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw forgeError('NOT_FOUND', `File not found: ${path}`);
    return { path, bytes: new TextEncoder().encode(text), revision: String(text.length) };
  }
  async list(): Promise<string[]> { return [...this.files.keys()].sort(); }
  async writeBatch(): Promise<WriteBatchResult> { throw new Error('MemoryFiles is read-only.'); }
  async remove(): Promise<FileChange> { throw new Error('MemoryFiles is read-only.'); }
  async commit(): Promise<BatchResult> { throw new Error('MemoryFiles is read-only.'); }
  async stat(path: string): Promise<FileStat> {
    const { bytes, revision } = await this.read(path);
    return { path, kind: 'file', revision, bytes: bytes.length };
  }
}

/** Every observable part of a loaded cache, for comparing an incrementally updated index with a fresh build. */
export function metadataState(cache: MetadataCache) {
  return JSON.parse(JSON.stringify({
    files: cache.files(),
    caches: cache.files().map(path => [path, cache.getFileCache(path)]),
    resolvedLinks: cache.resolvedLinks,
    unresolvedLinks: cache.unresolvedLinks,
    // Plain equality ignores key order, which JSON output and iteration expose.
    keyOrder: [cache.resolvedLinks, cache.unresolvedLinks].map(map => Object.entries(map).map(([source, targets]) => [source, Object.keys(targets)])),
    references: cache.files().map(path => [path, cache.references(path)]),
    backlinks: cache.files().map(path => [path, cache.backlinks(path)]),
    issues: cache.issues(),
  })) as unknown;
}
