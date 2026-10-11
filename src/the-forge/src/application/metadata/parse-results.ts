import type { FileSnapshot } from '../../domain/documents/file.ts';
import {
  outcomeKey, readSnapshot, snapshotFormat, unchangedFile, type FileStamp, type MetadataSnapshot, type ParseOutcome, type SnapshotFile,
} from '../../domain/metadata/snapshot.ts';
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
  private readonly records = new Map<string, SnapshotFile>();
  private checkedAtMs = 0;
  private changed = false;

  constructor(private readonly options: SnapshotOptions | undefined) {}

  /** The scope's files with stamps from the store, or the repository listing without stamps. */
  async listing(list: () => Promise<string[]>): Promise<StampedListing | { checkedAtMs: null; files: Array<{ path: string }> }> {
    if (this.options === undefined) return { checkedAtMs: null, files: (await list()).map(path => ({ path })) };
    const listing = await this.options.store.listing();
    this.checkedAtMs = listing.checkedAtMs;
    return listing;
  }

  /** The previous snapshot, loaded once; null without a store or when it is missing, unreadable or for another key. */
  stored(): Promise<MetadataSnapshot | null> {
    const options = this.options;
    this.previous ??= options === undefined ? Promise.resolve(null) : options.store.load().then(value => readSnapshot(value, options.key), () => null);
    return this.previous;
  }

  /** The stored outcome of a file whose stamp is unchanged since the previous snapshot, recorded as current. */
  async unchanged(path: string, stamp: FileStamp | undefined): Promise<ParseOutcome | undefined> {
    const previous = await this.stored();
    const stored = previous && Object.hasOwn(previous.files, path) ? previous.files[path] : undefined;
    if (!previous || !unchangedFile(stored, stamp, previous.checkedAtMs)) return undefined;
    const outcome = this.outcome(previous, outcomeKey(path, stored!.revision));
    if (outcome !== undefined) this.records.set(path, { stamp: stamp!.stamp, revision: stored!.revision });
    return outcome;
  }

  /** The stored outcome for read content with the same revision, or undefined when it must be parsed. */
  async reusable(file: FileSnapshot): Promise<ParseOutcome | undefined> {
    const previous = await this.stored();
    return previous ? this.outcome(previous, outcomeKey(file.path, file.revision)) : undefined;
  }

  /** Records that the index holds `revision` for `path`, read after `stamp` was taken (null: no stamp). */
  read(path: string, revision: string, stamp: FileStamp | null): void {
    if (this.options === undefined) return;
    this.records.set(path, { stamp: stamp?.stamp ?? null, revision });
    this.changed = true;
  }

  /** The recorded revision of an indexed path, if any. */
  revision(path: string): string | undefined { return this.records.get(path)?.revision; }

  forget(path: string): void {
    if (this.records.delete(path)) this.changed = true;
  }

  /** After a build: a missing previous snapshot or a file that left the vault makes the snapshot outdated. */
  async built(): Promise<void> {
    const previous = await this.stored();
    if (previous === null || Object.keys(previous.files).some(path => !this.records.has(path))) this.changed = true;
  }

  /**
   * Stores the index's current outcomes unless nothing may or needs to be written: no store, a dry run, or no file
   * read, changed, added or removed since the previous snapshot. A failed save throws and leaves the state outdated.
   */
  async persist(outcomeOf: (path: string) => ParseOutcome | undefined): Promise<void> {
    if (this.options === undefined || !this.options.save || !this.changed) return;
    await this.options.store.save(this.next(this.options.key, outcomeOf));
    this.changed = false;
  }

  private next(key: string, outcomeOf: (path: string) => ParseOutcome | undefined): MetadataSnapshot {
    const files: Array<[string, SnapshotFile]> = [], outcomes = new Map<string, ParseOutcome>();
    for (const [path, record] of this.records) {
      const outcome = outcomeOf(path);
      if (outcome === undefined) continue;
      files.push([path, record]);
      outcomes.set(outcomeKey(path, record.revision), outcome);
    }
    return { format: snapshotFormat, key, checkedAtMs: this.checkedAtMs, files: Object.fromEntries(files), outcomes: Object.fromEntries(outcomes) };
  }

  private outcome(previous: MetadataSnapshot, key: string): ParseOutcome | undefined {
    return Object.hasOwn(previous.outcomes, key) ? previous.outcomes[key] : undefined;
  }
}
