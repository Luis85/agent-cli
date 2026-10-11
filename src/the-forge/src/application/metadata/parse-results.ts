import {
  outcomeKey, racyWindowMs, readSnapshot, snapshotFormat, unchangedFile, type FileStamp, type MetadataSnapshot, type SnapshotFile, type StoredLinks,
} from '../../domain/metadata/snapshot.ts';
import { decodeOutcome, encodeOutcome, type ParseOutcome, type StoredOutcome, type StoredResolution } from '../../domain/metadata/snapshot-encoding.ts';
import type { MetadataSnapshotStore, StampedListing } from './ports.ts';

/**
 * Persisted parse results for one index: the store, the key that names the Forge build, parser and scope they belong
 * to, and whether `persist()` may write (never during a dry run).
 */
export interface SnapshotOptions { store: MetadataSnapshotStore; key: string; save: boolean }

/**
 * The bookkeeping between a metadata index and its stored snapshot. It loads the previous snapshot once, answers
 * which files can be reused by stamp or by content revision, records what the index holds now and builds the next
 * snapshot. Without a store it only lists the repository and reuses nothing.
 */
export class ParseResults {
  private previous: Promise<MetadataSnapshot | null> | undefined;
  /** The previous snapshot once `previous` settled; undefined before. */
  private loaded: MetadataSnapshot | null | undefined;
  private readonly records = new Map<string, SnapshotFile>();
  /** Stored outcomes decoded so far, by outcome key; undefined for one that could not be decoded. */
  private readonly decoded = new Map<string, ParseOutcome | undefined>();
  private checkedAtMs = 0;
  private changed = false;

  constructor(private readonly options: SnapshotOptions | undefined) {}

  /** The scope's files with stamps from the store for those `stamped` accepts, or the repository listing without stamps. */
  async listing(list: () => Promise<string[]>, stamped: (path: string) => boolean): Promise<StampedListing | { checkedAtMs: null; files: Array<{ path: string }> }> {
    if (this.options === undefined) return { checkedAtMs: null, files: (await list()).map(path => ({ path })) };
    const listing = await this.options.store.listing(stamped);
    this.checkedAtMs = listing.checkedAtMs;
    return listing;
  }

  /** The previous snapshot, loaded once; null without a store or when it is missing, unreadable or for another key. */
  stored(): Promise<MetadataSnapshot | null> {
    const options = this.options;
    this.previous ??= (options === undefined ? Promise.resolve(null) : options.store.load().then(value => readSnapshot(value, options.key), () => null))
      .then(snapshot => { this.loaded = snapshot; return snapshot; });
    return this.previous;
  }

  /**
   * The stored outcome of a file whose stamp is unchanged since the previous snapshot, recorded as current. Answers
   * from the loaded snapshot without waiting, so call it once `stored()` has settled; before that it reuses nothing.
   */
  unchanged(path: string, stamp: FileStamp | undefined): ParseOutcome | undefined {
    const previous = this.loaded;
    const stored = previous && Object.hasOwn(previous.files, path) ? previous.files[path] : undefined;
    if (!previous || !unchangedFile(stored, stamp, previous.checkedAtMs)) return undefined;
    const outcome = this.outcome(previous, outcomeKey(path, stored!.revision));
    if (outcome !== undefined) this.records.set(path, { stamp: stamp!.stamp, revision: stored!.revision });
    return outcome;
  }

  /** The stored outcome for content of `revision` at `path`, or undefined when it must be parsed. */
  async reusable(path: string, revision: string): Promise<ParseOutcome | undefined> {
    const previous = await this.stored();
    return previous ? this.outcome(previous, outcomeKey(path, revision)) : undefined;
  }

  /**
   * Records that the index holds `revision` for `path`, read after `stamp` was taken (null: no stamp). The snapshot
   * becomes outdated when the record differs from the stored one, or when storing it would let the next load trust
   * the stamp. A file that stays inside the racy window, such as one with a future timestamp, is read again on every
   * load but does not rewrite an otherwise unchanged snapshot.
   */
  read(path: string, revision: string, stamp: FileStamp | null): void {
    if (this.options === undefined) return;
    const record = { stamp: stamp?.stamp ?? null, revision };
    this.records.set(path, record);
    const before = this.loaded && Object.hasOwn(this.loaded.files, path) ? this.loaded.files[path] : undefined;
    const same = before !== undefined && before.stamp === record.stamp && before.revision === revision;
    const undecodable = this.decoded.has(outcomeKey(path, revision)) && this.decoded.get(outcomeKey(path, revision)) === undefined;
    if (!same || undecodable || (stamp !== null && stamp.changedMs < this.checkedAtMs - racyWindowMs)) this.changed = true;
  }

  /** The recorded revision of an indexed path, if any. */
  revision(path: string): string | undefined { return this.records.get(path)?.revision; }

  forget(path: string): void {
    if (this.records.delete(path)) this.changed = true;
  }

  /** The vault's paths or aliases changed, so the stored link resolutions no longer match. */
  outdated(): void { this.changed = true; }

  /**
   * After the files are indexed: the stored resolutions of each source whose content is unchanged since the stored
   * snapshot, provided the index has the stored vault paths (in order) and aliases. Otherwise the snapshot is
   * outdated and nothing is reused.
   */
  async links(paths: readonly string[], aliases: string): Promise<(source: string) => readonly StoredResolution[] | undefined> {
    const previous = await this.stored(), links = previous?.links;
    if (!previous || !links || links.aliases !== aliases || links.paths.length !== paths.length || links.paths.some((path, position) => path !== paths[position])) {
      this.changed = true;
      return () => undefined;
    }
    return source => Object.hasOwn(links.sources, source) && Object.hasOwn(previous.files, source) && previous.files[source]!.revision === this.revision(source)
      ? links.sources[source] : undefined;
  }

  /** After a build: a missing previous snapshot or a file that left the vault makes the snapshot outdated. */
  async built(): Promise<void> {
    const previous = await this.stored();
    if (previous === null || Object.keys(previous.files).some(path => !this.records.has(path))) this.changed = true;
  }

  /**
   * Stores the index's current outcomes and `links` unless nothing may or needs to be written: no store, a dry run,
   * or nothing that differs from the previous snapshot. A failed save throws and leaves the state outdated.
   */
  async persist(outcomeOf: (path: string) => ParseOutcome | undefined, links: () => StoredLinks): Promise<void> {
    if (this.options === undefined || !this.options.save || !this.changed) return;
    await this.options.store.save(this.next(this.options.key, outcomeOf, links()));
    this.changed = false;
  }

  private next(key: string, outcomeOf: (path: string) => ParseOutcome | undefined, links: StoredLinks): MetadataSnapshot {
    const files: Array<[string, SnapshotFile]> = [], outcomes = new Map<string, StoredOutcome>();
    for (const [path, record] of this.records) {
      const outcome = outcomeOf(path);
      if (outcome === undefined) continue;
      files.push([path, record]);
      const stored = outcomeKey(path, record.revision);
      if (!outcomes.has(stored)) outcomes.set(stored, encodeOutcome(outcome));
    }
    return { format: snapshotFormat, key, checkedAtMs: this.checkedAtMs, files: Object.fromEntries(files), outcomes: Object.fromEntries(outcomes), links };
  }

  /** A stored outcome, decoded once per key: files with the same content share it. */
  private outcome(previous: MetadataSnapshot, key: string): ParseOutcome | undefined {
    if (!Object.hasOwn(previous.outcomes, key)) return undefined;
    if (!this.decoded.has(key)) this.decoded.set(key, decodeOutcome(previous.outcomes[key]!));
    return this.decoded.get(key);
  }
}
