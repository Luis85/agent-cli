import { AppError, errorMessage } from '../../domain/shared/errors.ts';
import type { CachedMetadata } from '../../domain/metadata/cache.ts';
import { fileToLinktext, linkIndex, resolveLinkpath, type LinkIndex } from '../../domain/metadata/link-resolution.ts';
import type { FileRepository } from '../workspace/ports.ts';
import type {
  Backlink, LinkCounts, MetadataCache, MetadataChange, MetadataIndex, MetadataIssue, MetadataParser, MetadataUpdate, SourceReference,
} from './ports.ts';

const pendingFileReads = 16;
const visible = (path: string) => !path.split('/').some(part => part.startsWith('.'));
const missing = (error: unknown) => error instanceof AppError && error.code === 'NOT_FOUND';
const counts = (): Record<string, number> => Object.create(null) as Record<string, number>;
const vaultOrder = (paths: Iterable<string>) => [...paths].sort();

async function eachConcurrently<Item>(items: readonly Item[], limit: number, work: (item: Item) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}

/** Body links and embeds in document order, then frontmatter links, then Canvas file nodes, all unresolved. */
function orderedReferences(cache: CachedMetadata): Array<Omit<SourceReference, 'resolution'>> {
  const body = [
    ...(cache.links ?? []).map(reference => ({ kind: 'link' as const, reference })),
    ...(cache.embeds ?? []).map(reference => ({ kind: 'embed' as const, reference })),
  ].sort((a, b) => a.reference.position.start.offset - b.reference.position.start.offset);
  return [
    ...body,
    ...(cache.frontmatterLinks ?? []).map(reference => ({ kind: 'frontmatter' as const, reference })),
    ...(cache.canvasLinks ?? []).map(reference => ({ kind: 'canvas' as const, reference })),
  ];
}

/**
 * A per-invocation metadata index over a file repository. It reads and parses Markdown and Canvas files once,
 * on first load, and resolves every reference through hash lookups, so building is linear in vault size.
 * Updates re-parse only changed files; they re-resolve every source only when the set of paths or aliases changes.
 */
export class VaultMetadata implements MetadataIndex, MetadataCache {
  readonly resolvedLinks: LinkCounts = Object.create(null) as LinkCounts;
  readonly unresolvedLinks: LinkCounts = Object.create(null) as LinkCounts;
  private paths: string[] = [];
  private readonly caches = new Map<string, CachedMetadata>();
  private readonly problems = new Map<string, MetadataIssue>();
  private readonly outgoing = new Map<string, SourceReference[]>();
  private readonly incoming = new Map<string, Set<string>>();
  private index: LinkIndex = linkIndex([]);
  private loading: Promise<void> | undefined;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly repository: FileRepository, private readonly parser: MetadataParser) {}

  load(): Promise<MetadataCache> {
    this.loading ??= this.build();
    return this.loading.then(() => this);
  }

  update(changes: readonly MetadataChange[]): Promise<MetadataUpdate> {
    if (!this.loading) return Promise.resolve({ changed: [], deleted: [], resolved: [] });
    const result = this.pending.then(() => this.loading).then(() => this.apply(changes));
    this.pending = result.catch(() => undefined);
    return result;
  }

  invalidate(paths: readonly string[]): Promise<MetadataUpdate> {
    return this.update(paths.map(path => ({ path, operation: 'updated' as const })));
  }

  files(): readonly string[] { return this.paths; }
  getFileCache(path: string): CachedMetadata | null { return this.caches.get(path) ?? null; }
  issues(): MetadataIssue[] { return vaultOrder(this.problems.keys()).map(path => this.problems.get(path)!); }
  references(sourcePath: string): readonly SourceReference[] { return this.outgoing.get(sourcePath) ?? []; }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): string | null {
    const result = resolveLinkpath(this.index, linkpath, sourcePath);
    return result.status === 'resolved' ? result.path : null;
  }

  fileToLinktext(path: string, sourcePath: string, omitMdExtension = true): string {
    return fileToLinktext(this.index, path, sourcePath, omitMdExtension);
  }

  backlinks(path: string): Backlink[] {
    return vaultOrder(this.incoming.get(path) ?? []).filter(source => source !== path).flatMap(source => this.references(source)
      .filter(item => item.resolution.status === 'resolved' && item.resolution.path === path)
      .map(item => ({ ...item, source })));
  }

  private async build(): Promise<void> {
    this.paths = (await this.repository.list()).filter(visible);
    await eachConcurrently(this.paths.filter(path => this.parser.indexes(path)), pendingFileReads, async path => {
      this.parse(path, (await this.repository.read(path)).bytes);
    });
    this.reindex();
    for (const source of this.sources()) this.resolve(source);
  }

  private parse(path: string, bytes: Uint8Array): void {
    try {
      this.caches.set(path, this.parser.parse(path, bytes));
      this.problems.delete(path);
    } catch (error) {
      this.caches.delete(path);
      this.problems.set(path, { path, code: error instanceof AppError ? error.code : 'INVALID_FILE', message: errorMessage(error) });
    }
  }

  private async apply(changes: readonly MetadataChange[]): Promise<MetadataUpdate> {
    const touched = new Set<string>(), removed = new Set<string>();
    for (const change of changes) {
      if (change.operation === 'renamed') { removed.add(change.oldPath); touched.add(change.path); }
      else if (change.operation === 'deleted') removed.add(change.path);
      else touched.add(change.path);
    }
    for (const path of touched) removed.delete(path);
    const before = new Set(this.paths), aliasesBefore = new Map([...touched, ...removed].map(path => [path, this.aliasKey(path)]));
    const contents = new Map<string, Uint8Array>();
    await eachConcurrently([...touched].filter(visible), pendingFileReads, async path => {
      try { contents.set(path, (await this.repository.read(path)).bytes); }
      catch (error) { if (!missing(error)) throw error; removed.add(path); }
    });
    const changed: string[] = [], deleted: string[] = [];
    for (const path of removed) {
      if (!before.has(path)) continue;
      this.caches.delete(path); this.problems.delete(path);
      this.forget(path);
      deleted.push(path);
    }
    for (const [path, bytes] of contents) {
      if (!this.parser.indexes(path)) continue;
      this.parse(path, bytes);
      changed.push(path);
    }
    const paths = vaultOrder(new Set([...this.paths.filter(path => !removed.has(path)), ...contents.keys()]));
    const pathsChanged = paths.length !== this.paths.length || paths.some((path, position) => path !== this.paths[position]);
    const aliasesChanged = [...aliasesBefore].some(([path, key]) => key !== this.aliasKey(path));
    this.paths = paths;
    for (const path of changed) if (!this.caches.has(path)) this.forget(path);
    let resolved: string[];
    if (pathsChanged || aliasesChanged) {
      this.reindex();
      const previous = new Map(this.sources().map(source => [source, this.resolutionKey(source)]));
      for (const source of this.sources()) this.resolve(source);
      resolved = this.sources().filter(source => contents.has(source) || previous.get(source) !== this.resolutionKey(source));
    } else {
      resolved = vaultOrder(changed.filter(path => this.caches.has(path)));
      for (const source of resolved) this.resolve(source);
    }
    this.reorder();
    return { changed: vaultOrder(changed), deleted: vaultOrder(deleted), resolved };
  }

  private aliasKey(path: string): string { return JSON.stringify(this.caches.get(path)?.aliases ?? []); }
  private resolutionKey(source: string): string | undefined {
    const references = this.outgoing.get(source);
    return references && JSON.stringify(references.map(item => item.resolution));
  }
  private sources(): string[] { return this.paths.filter(path => this.caches.has(path)); }

  private reindex(): void {
    const aliases = new Map(this.sources().flatMap(path => {
      const names = this.caches.get(path)!.aliases;
      return names?.length ? [[path, names] as const] : [];
    }));
    this.index = linkIndex(this.paths, aliases);
  }

  /** Re-resolves one parsed source and replaces its link counts and backlink entries. */
  private resolve(source: string): void {
    this.unlink(source);
    const references = orderedReferences(this.caches.get(source)!).flatMap(item => {
      const relative = !['wikilink', 'canvas'].includes(item.reference.syntax);
      const resolution = resolveLinkpath(this.index, item.reference.link, source, { relative, aliases: true });
      return resolution.status === 'external' ? [] : [{ ...item, resolution } as SourceReference];
    });
    const resolved = counts(), unresolved = counts();
    for (const { resolution } of references) {
      if (resolution.status === 'resolved') {
        resolved[resolution.path] = (resolved[resolution.path] ?? 0) + 1;
        const sources = this.incoming.get(resolution.path) ?? new Set<string>();
        this.incoming.set(resolution.path, sources.add(source));
      } else if (resolution.status === 'unresolved') unresolved[resolution.linkpath] = (unresolved[resolution.linkpath] ?? 0) + 1;
    }
    this.outgoing.set(source, references);
    this.resolvedLinks[source] = resolved;
    this.unresolvedLinks[source] = unresolved;
  }

  private unlink(source: string): void {
    for (const item of this.outgoing.get(source) ?? []) {
      if (item.resolution.status === 'resolved') this.incoming.get(item.resolution.path)?.delete(source);
    }
  }

  /** Removes a source's outgoing references and link counts. */
  private forget(source: string): void {
    this.unlink(source);
    this.outgoing.delete(source);
    delete this.resolvedLinks[source];
    delete this.unresolvedLinks[source];
  }

  /** Keeps the link maps' key order equal to a fresh build after sources were added. */
  private reorder(): void {
    for (const maps of [this.resolvedLinks, this.unresolvedLinks]) {
      const entries = this.sources().map(source => [source, maps[source]!] as const);
      for (const [source, value] of entries) { delete maps[source]; maps[source] = value; }
    }
  }
}
