import type { CachedMetadata } from '../../domain/metadata/cache.ts';
import type { EventBus } from '../plugins/events.ts';
import { publishHostEvent, type CachedMetadataRecord } from '../plugins/host-events.ts';
import type { CommitObserver, CommittedBatch } from '../workspace/ports.ts';
import type { MetadataChange, MetadataIndex } from './ports.ts';

/** Event payloads carry the cache's JSON form, detached from the live index. */
const record = (cache: CachedMetadata): CachedMetadataRecord => JSON.parse(JSON.stringify(cache)) as CachedMetadataRecord;

/**
 * Keeps the invocation's metadata index current after each committed batch and publishes Obsidian's
 * `metadataCache` events for it. The index is never built for a write: before the first load in the invocation an
 * update does nothing and no event is published. Once loaded, one batch publishes `metadataCache.changed` for each
 * re-indexed file that has metadata, `metadataCache.deleted` for each file that left the index,
 * `metadataCache.resolve` for each re-resolved source (each group in vault path order), then one
 * `metadataCache.resolved`. Paths are relative to the index root.
 */
export class MetadataCacheEvents implements CommitObserver {
  constructor(private readonly events: EventBus, private readonly index: MetadataIndex) {}

  async committed({ renames, changes }: CommittedBatch): Promise<void> {
    const update = await this.index.update([
      ...renames.map(({ from, to }): MetadataChange => ({ path: to, oldPath: from, operation: 'renamed' })),
      ...changes.map(({ path, operation }): MetadataChange => ({ path, operation })),
    ]);
    if (!update) return;
    const cache = await this.index.load();
    for (const path of update.changed) {
      const metadata = cache.getFileCache(path);
      if (metadata) await publishHostEvent(this.events, 'metadataCache.changed', { path, cache: record(metadata) });
    }
    for (const path of update.deleted) {
      const previous = update.prevCaches[path] ?? null;
      await publishHostEvent(this.events, 'metadataCache.deleted', { path, prevCache: previous && record(previous) });
    }
    for (const path of update.resolved) await publishHostEvent(this.events, 'metadataCache.resolve', { path });
    await publishHostEvent(this.events, 'metadataCache.resolved', {});
  }
}
