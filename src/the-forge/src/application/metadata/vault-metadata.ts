import { AppError, errorMessage } from '../../domain/shared/errors.ts';
import { isNotFound } from '../../domain/shared/not-found.ts';
import type { CachedMetadata } from '../../domain/metadata/cache.ts';
import { closestDestination, fileToLinktext, linkIndex, resolveLinkpath, type LinkIndex } from '../../domain/metadata/link-resolution.ts';
import type { FileSnapshot } from '../../domain/documents/file.ts';
import { aliasesKey, type FileStamp, type StoredLinks } from '../../domain/metadata/snapshot.ts';
import { decodeResolution, encodeResolution, type ParseOutcome, type StoredResolution } from '../../domain/metadata/snapshot-encoding.ts';
import type { FileRepository } from '../workspace/ports.ts';
import { ParseResults, type SnapshotOptions } from './parse-results.ts';
import type {
  Backlink, LinkCounts, MetadataCache, MetadataChange, MetadataIndex, MetadataIssue, MetadataParser, MetadataUpdate, SourceReference,
} from './ports.ts';

const pendingFileReads = 16;
/** The workspace's fixed distribution folder: configuration, plugins, templates and the bundle, not vault content. */
const workspaceDistribution = 'bin';

/**
 * The vault rule of enumeration: a path belongs to the vault when no segment starts with a dot (`.obsidian`,
 * `.trash`, `.forge`, `.git`) and, at the workspace root, it is not below the workspace's `bin/` distribution
 * (compared without letter case). The index, `search`, `links`, Bases and the `app.vault` listings enumerate only
 * these paths; direct reads such as `read bin/config.json` are unaffected.
 */
export function vaultMember(path: string, workspaceRoot: boolean): boolean {
  const segments = path.split('/');
  return !segments.some(part => part.startsWith('.')) && !(workspaceRoot && segments.length > 1 && segments[0]!.toLowerCase() === workspaceDistribution);
}
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
 * `workspaceRoot` marks an index of the workspace root, which leaves out the workspace's `bin/` distribution;
 * `snapshots` persists parse results between invocations. `revisionOf` computes the repository's content revision
 * of bytes (SHA-256 for the workspace files); `parseFile` reuses a known result only for the revision it computes
 * itself, and without it always parses.
 */
export interface VaultMetadataOptions { workspaceRoot?: boolean; snapshots?: SnapshotOptions; revisionOf?: (bytes: Uint8Array) => string }

/**
 * A per-invocation metadata index over a file repository. It reads and parses Markdown and Canvas files once,
 * on first load, and resolves every reference through hash lookups, so building is linear in vault size.
 * With a snapshot store, the load reuses the parse results of unchanged files and of known content revisions
 * instead of reading or parsing them, and the stored resolutions of unchanged sources while the vault's paths and
 * aliases are unchanged; `persist()` stores the current results and resolutions.
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
  /** The link index over `paths` and `aliasMap`, built on first use after each reindex. */
  private builtIndex: LinkIndex | undefined;
  private aliasMap: ReadonlyMap<string, readonly string[]> = new Map();
  /** `aliasesKey` of `aliasMap`. */
  private aliases = aliasesKey(new Map());
  private loading: Promise<void> | undefined;
  private pending: Promise<unknown> = Promise.resolve();

  private readonly member: (path: string) => boolean;
  private readonly workspaceRoot: boolean;
  private readonly results: ParseResults;
  private readonly revisionOf: ((bytes: Uint8Array) => string) | undefined;

  constructor(private readonly repository: FileRepository, private readonly parser: MetadataParser, options: VaultMetadataOptions = {}) {
    const workspaceRoot = options.workspaceRoot ?? false;
    this.workspaceRoot = workspaceRoot;
    this.revisionOf = options.revisionOf;
    this.member = path => vaultMember(path, workspaceRoot);
    this.results = new ParseResults(options.snapshots);
  }

  load(): Promise<MetadataCache> {
    this.loading ??= this.build();
    return this.loading.then(() => this);
  }

  async vaultFiles(): Promise<readonly string[]> {
    if (this.loading) return (await this.load()).files();
    return (await this.repository.list()).filter(this.member);
  }

  async parseFile(file: { path: string; bytes: Uint8Array }): Promise<CachedMetadata | null> {
    if (!this.member(file.path) || !this.parser.indexes(file.path)) return null;
    // Reuse is keyed by the revision of these very bytes, never by a revision the caller carries along.
    const revision = this.revisionOf?.(file.bytes);
    if (revision !== undefined && this.loading) {
      await this.load();
      if (this.results.revision(file.path) === revision) return this.caches.get(file.path) ?? null;
    }
    const outcome = (revision === undefined ? undefined : await this.results.reusable(file.path, revision)) ?? this.outcome(file.path, file.bytes);
    return 'metadata' in outcome ? outcome.metadata : null;
  }

  /**
   * Stores the parse results of a loaded index when anything was read or changed since the stored snapshot; does
   * nothing without a store, during a dry run, before the first load or after a failed load (the command reports
   * that failure). A failed save throws and stores nothing.
   */
  async persist(): Promise<void> {
    if (!this.loading) return;
    try { await this.loading; } catch { return; }
    await this.pending;
    await this.results.persist(path => {
      const metadata = this.caches.get(path), issue = this.problems.get(path);
      return metadata ? { metadata } : issue ? { issue: { code: issue.code, message: issue.message } } : undefined;
    }, () => this.storedLinks());
  }

  /** Every source's resolutions by the place of each reference among its ordered references (externals included). */
  private storedLinks(): StoredLinks {
    const positions = new Map(this.paths.map((path, position) => [path, position]));
    const sources = this.sources().map(source => {
      const references = this.outgoing.get(source) ?? [];
      let next = 0;
      return [source, orderedReferences(this.caches.get(source)!).map(item => references[next]?.reference === item.reference
        ? encodeResolution(references[next++]!.resolution, path => positions.get(path)!) : null)] as const;
    });
    return { paths: [...this.paths], aliases: this.aliases, sources: Object.fromEntries(sources) };
  }

  parseContent(path: string, bytes: Uint8Array): CachedMetadata | null {
    return this.parser.indexes(path) ? this.parser.parse(path, bytes) : null;
  }

  async fork(repository: FileRepository): Promise<VaultMetadata> {
    const fork = new VaultMetadata(repository, this.parser, { workspaceRoot: this.workspaceRoot, ...(this.revisionOf ? { revisionOf: this.revisionOf } : {}) });
    if (!this.loading) return fork;
    await this.load();
    await this.pending;
    // Cached metadata, reference lists, link counts and the link index are replaced on change, never mutated.
    fork.paths = [...this.paths];
    for (const [path, cache] of this.caches) fork.caches.set(path, cache);
    for (const [path, issue] of this.problems) fork.problems.set(path, issue);
    for (const [path, references] of this.outgoing) fork.outgoing.set(path, references);
    for (const [path, sources] of this.incoming) fork.incoming.set(path, new Set(sources));
    Object.assign(fork.resolvedLinks, this.resolvedLinks);
    Object.assign(fork.unresolvedLinks, this.unresolvedLinks);
    fork.builtIndex = this.builtIndex;
    fork.aliasMap = this.aliasMap;
    fork.aliases = this.aliases;
    fork.loading = Promise.resolve();
    return fork;
  }

  update(changes: readonly MetadataChange[]): Promise<MetadataUpdate | null> {
    if (!this.loading) return Promise.resolve(null);
    const result = this.pending.then(() => this.loading).then(() => this.apply(changes));
    this.pending = result.catch(() => undefined);
    return result;
  }

  invalidate(paths: readonly string[]): Promise<MetadataUpdate | null> {
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

  getClosestLinkpathDest(linkpath: string, sourcePath: string): string | null {
    return closestDestination(resolveLinkpath(this.index, linkpath, sourcePath), sourcePath);
  }

  fileToLinktext(path: string, sourcePath: string, omitMdExtension = true): string {
    return fileToLinktext(this.index, path, sourcePath, omitMdExtension);
  }

  backlinks(path: string): Backlink[] {
    return vaultOrder(this.incoming.get(path) ?? []).filter(source => source !== path).flatMap(source => this.references(source)
      .filter(item => item.resolution.status === 'resolved' && item.resolution.path === path)
      .map(item => ({ ...item, source })));
  }

  /**
   * Lists the vault, then takes each indexed file's parse result from the stored snapshot when its stamp is
   * unchanged, else reads it and reuses a stored result of the same content revision or parses it.
   */
  private async build(): Promise<void> {
    const listing = await this.results.listing(() => this.repository.list(), path => this.member(path) && this.parser.indexes(path));
    const stamps = new Map<string, FileStamp>();
    for (const file of listing.files) if ('stamp' in file) stamps.set(file.path, file);
    this.paths = listing.files.map(file => file.path).filter(this.member);
    await this.results.stored();
    // Unchanged files come from the loaded snapshot without any asynchronous step; only the rest are read.
    const changed = this.paths.filter(path => {
      if (!this.parser.indexes(path)) return false;
      const unchanged = this.results.unchanged(path, stamps.get(path));
      if (unchanged !== undefined) this.adopt(path, unchanged);
      return unchanged === undefined;
    });
    await eachConcurrently(changed, pendingFileReads, async path => {
      const stamp = stamps.get(path);
      const file = await this.repository.read(path);
      this.adopt(path, await this.results.reusable(path, file.revision) ?? this.outcome(path, file.bytes));
      this.results.read(path, file.revision, stamp ?? null);
    });
    await this.results.built();
    this.reindex();
    const stored = await this.results.links(this.paths, this.aliases);
    for (const source of this.sources()) this.resolve(source, stored(source));
  }

  private outcome(path: string, bytes: Uint8Array): ParseOutcome {
    try { return { metadata: this.parser.parse(path, bytes) }; }
    catch (error) { return { issue: { code: error instanceof AppError ? error.code : 'INVALID_FILE', message: errorMessage(error) } }; }
  }

  private adopt(path: string, outcome: ParseOutcome): void {
    if ('metadata' in outcome) {
      this.caches.set(path, outcome.metadata);
      this.problems.delete(path);
    } else {
      this.caches.delete(path);
      this.problems.set(path, { path, ...outcome.issue });
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
    const contents = new Map<string, FileSnapshot>();
    await eachConcurrently([...touched].filter(this.member), pendingFileReads, async path => {
      try { contents.set(path, await this.repository.read(path)); }
      catch (error) { if (!isNotFound(error)) throw error; removed.add(path); }
    });
    const changed: string[] = [], deleted: string[] = [];
    const prevCaches = Object.create(null) as Record<string, CachedMetadata | null>;
    for (const path of removed) {
      if (!before.has(path)) continue;
      prevCaches[path] = this.caches.get(path) ?? null;
      this.caches.delete(path); this.problems.delete(path);
      this.forget(path);
      this.results.forget(path);
      deleted.push(path);
    }
    for (const [path, file] of contents) {
      if (!this.parser.indexes(path)) continue;
      this.adopt(path, this.outcome(path, file.bytes));
      // Read after the commit without a stamp: the next load reads it again and reuses this result by revision.
      this.results.read(path, file.revision, null);
      changed.push(path);
    }
    const paths = vaultOrder(new Set([...this.paths.filter(path => !removed.has(path)), ...contents.keys()]));
    const pathsChanged = paths.length !== this.paths.length || paths.some((path, position) => path !== this.paths[position]);
    const aliasesChanged = [...aliasesBefore].some(([path, key]) => key !== this.aliasKey(path));
    this.paths = paths;
    for (const path of changed) if (!this.caches.has(path)) this.forget(path);
    let resolved: string[];
    if (pathsChanged || aliasesChanged) {
      this.results.outdated();
      this.reindex();
      const previous = new Map(this.sources().map(source => [source, this.resolutionKey(source)]));
      for (const source of this.sources()) this.resolve(source);
      resolved = this.sources().filter(source => contents.has(source) || previous.get(source) !== this.resolutionKey(source));
    } else {
      resolved = vaultOrder(changed.filter(path => this.caches.has(path)));
      for (const source of resolved) this.resolve(source);
    }
    this.reorder();
    return { changed: vaultOrder(changed), deleted: vaultOrder(deleted), resolved, prevCaches };
  }

  private aliasKey(path: string): string { return JSON.stringify(this.caches.get(path)?.aliases ?? []); }
  private resolutionKey(source: string): string | undefined {
    const references = this.outgoing.get(source);
    return references && JSON.stringify(references.map(item => item.resolution));
  }
  private sources(): string[] { return this.paths.filter(path => this.caches.has(path)); }

  /** Takes the current paths and aliases for the link index, which is built when a link is first resolved. */
  private reindex(): void {
    this.aliasMap = new Map(this.sources().flatMap(path => {
      const names = this.caches.get(path)!.aliases;
      return names?.length ? [[path, names] as const] : [];
    }));
    this.aliases = aliasesKey(this.aliasMap);
    this.builtIndex = undefined;
  }

  // Paths are replaced, never mutated, and change only together with a reindex, so the lazy index stays current.
  private get index(): LinkIndex {
    this.builtIndex ??= linkIndex(this.paths, this.aliasMap);
    return this.builtIndex;
  }

  /**
   * Re-resolves one parsed source and replaces its link counts and backlink entries. `stored` resolutions, one per
   * ordered reference, come from a snapshot of the same paths, aliases and content; a malformed one is recomputed.
   */
  private resolve(source: string, stored?: readonly StoredResolution[]): void {
    this.unlink(source);
    const ordered = orderedReferences(this.caches.get(source)!), known = stored?.length === ordered.length ? stored : undefined;
    const references: SourceReference[] = [];
    for (const [place, item] of ordered.entries()) {
      const syntax = item.reference.syntax, relative = syntax !== 'wikilink' && syntax !== 'canvas';
      const resolution = (known && decodeResolution(known[place]!, this.paths)) ?? resolveLinkpath(this.index, item.reference.link, source, { relative, aliases: true });
      if (resolution.status !== 'external') references.push({ ...item, resolution } as SourceReference);
    }
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
