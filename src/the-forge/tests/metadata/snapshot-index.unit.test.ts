import { describe, expect, it } from 'vitest';
import type { MetadataParser, MetadataSnapshotStore } from '../../src/application/metadata/ports.ts';
import { VaultMetadata } from '../../src/application/metadata/vault-metadata.ts';
import type { MetadataSnapshot } from '../../src/domain/metadata/snapshot.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { ObsidianMetadataParser } from '../../src/infrastructure/metadata/parser.ts';
import { MemoryFiles, metadataIndex, metadataState } from '../support/metadata.ts';

const key = 'forge test; parser 1; scope .';
/** The content revision `StampedFiles` reports: the content itself. */
const revisionOf = (bytes: Uint8Array) => `sha:${new TextDecoder().decode(bytes)}`;
/** Far in the past relative to every listing, so stamps are outside the racy window unless a test says otherwise. */
const settled = 0;

/** Memory files whose revision is the content itself and whose stamps tests set; reads are counted. */
class StampedFiles extends MemoryFiles {
  readonly reads: string[] = [];
  readonly stamps = new Map<string, { stamp: string; changedMs: number }>();
  checkedAtMs = 1_000_000;
  override async read(path: string) {
    this.reads.push(path);
    const snapshot = await super.read(path);
    return { ...snapshot, revision: revisionOf(snapshot.bytes) };
  }
  /** Writes a file with a new stamp, as an external editor would. */
  put(path: string, content: string, stamp = `${path}@${content}`, changedMs = settled): void {
    this.files.set(path, content);
    this.stamps.set(path, { stamp, changedMs });
  }
  listing() {
    return { checkedAtMs: this.checkedAtMs, files: [...this.files.keys()].sort().map(path => ({ path, ...(this.stamps.get(path) ?? { stamp: `${path}@initial`, changedMs: settled }) })) };
  }
}

/** A store that keeps the snapshot in memory as JSON, like the file adapter. */
class MemoryStore implements MetadataSnapshotStore {
  stored: unknown = null;
  saves = 0;
  constructor(private readonly files: StampedFiles) {}
  async listing(stamped: (path: string) => boolean) {
    const listing = this.files.listing();
    return { ...listing, files: listing.files.map(file => stamped(file.path) ? file : { path: file.path }) };
  }
  async load() { return this.stored; }
  async save(snapshot: MetadataSnapshot) { this.saves++; this.stored = JSON.parse(JSON.stringify(snapshot)); }
}

/** The Obsidian parser with a log of the paths it parsed. */
function countingParser(parsed: string[]): MetadataParser {
  const parser = new ObsidianMetadataParser(new ObsidianDocuments());
  return { indexes: path => parser.indexes(path), parse: (path, bytes) => { parsed.push(path); return parser.parse(path, bytes); } };
}

function setup() {
  const files = new StampedFiles({});
  files.put('Notes/Plan.md', '# Plan\nSee [[Ideas]] and [[Missing]]. #plan\n');
  files.put('Notes/Ideas.md', '---\naliases: [Brainstorm]\n---\nBack to [[Plan]].\n');
  files.put('Bad.md', '---\nx: [\n---\n');
  files.put('Board.canvas', JSON.stringify({ nodes: [{ id: 'n', type: 'file', file: 'Notes/Plan.md', x: 0, y: 0, width: 1, height: 1 }] }));
  files.put('image.png', 'bytes');
  const store = new MemoryStore(files), parsed: string[] = [];
  const index = (save = true) => new VaultMetadata(files, countingParser(parsed), { workspaceRoot: true, snapshots: { store, key, save }, revisionOf });
  /** Loads a fresh index the way the next invocation does and persists it; returns what it read and parsed. */
  const invocation = async (save = true) => {
    files.reads.length = 0; parsed.length = 0;
    const metadata = index(save), cache = await metadata.load();
    await metadata.persist();
    return { cache, metadata, reads: [...files.reads].sort(), parsed: [...parsed].sort() };
  };
  return { files, store, invocation, fresh: async () => metadataState(await metadataIndex(files, { workspaceRoot: true }).load()) };
}

describe('persisted metadata snapshots', () => {
  it('parses everything once, then reuses unchanged files without reading them', async () => {
    const { store, invocation, fresh } = setup();
    const first = await invocation();
    expect(first.parsed).toEqual(['Bad.md', 'Board.canvas', 'Notes/Ideas.md', 'Notes/Plan.md']);
    expect(store.saves).toBe(1);
    expect(Object.keys((store.stored as MetadataSnapshot).files).sort()).toEqual(first.parsed);

    const second = await invocation();
    expect(second.reads).toEqual([]);
    expect(second.parsed).toEqual([]);
    expect(metadataState(second.cache)).toEqual(await fresh());
    // Stored metadata has exactly the parser's shape, without keys that JSON would drop or add.
    for (const path of second.cache.files()) expect(second.cache.getFileCache(path)).toStrictEqual(first.cache.getFileCache(path));
    expect(second.cache.issues()).toEqual([{ path: 'Bad.md', code: 'INVALID_YAML', message: expect.any(String) }]);
    // Nothing changed, so nothing is written again.
    expect(store.saves).toBe(1);
  });

  it('re-reads a file whose stamp changed and parses it only when its content changed', async () => {
    const { files, invocation, fresh } = setup();
    await invocation();
    files.put('Notes/Plan.md', files.files.get('Notes/Plan.md')!, 'touched');
    files.put('Notes/Ideas.md', '---\naliases: [Brainstorm, Thoughts]\n---\nBack to [[Plan]] and [[Missing]].\n');
    const next = await invocation();
    expect(next.reads).toEqual(['Notes/Ideas.md', 'Notes/Plan.md']);
    expect(next.parsed).toEqual(['Notes/Ideas.md']);
    expect(metadataState(next.cache)).toEqual(await fresh());
    expect(next.cache.getFileCache('Notes/Ideas.md')?.aliases).toEqual(['Brainstorm', 'Thoughts']);
  });

  it('re-reads files changed within the racy window even when their stamp is unchanged', async () => {
    const { files, invocation } = setup();
    files.put('Notes/Plan.md', files.files.get('Notes/Plan.md')!, 'same', files.checkedAtMs - 10);
    await invocation();
    // Same stamp, new content: only the racy rule notices, by re-reading it.
    files.files.set('Notes/Plan.md', '# Plan\nRewritten within the same timestamp tick. #racy\n');
    const next = await invocation();
    expect(next.reads).toEqual(['Notes/Plan.md']);
    expect(next.cache.getFileCache('Notes/Plan.md')?.tags?.map(tag => tag.tag)).toEqual(['#racy']);
    // Once a later listing is past the window, the stored stamp is trusted again.
    files.checkedAtMs += 60_000;
    await invocation();
    expect((await invocation()).reads).toEqual([]);
  });

  it('re-reads a file with a future timestamp on every load without rewriting an unchanged snapshot', async () => {
    const { files, store, invocation } = setup();
    // A synced note from a device whose clock runs ahead is never trusted by stamp.
    files.put('Notes/Plan.md', files.files.get('Notes/Plan.md')!, 'future', files.checkedAtMs + 365 * 86_400_000);
    await invocation();
    expect(store.saves).toBe(1);
    for (let run = 0; run < 3; run++) {
      files.checkedAtMs += 60_000;
      const next = await invocation();
      expect(next.reads).toEqual(['Notes/Plan.md']);
      expect(next.parsed).toEqual([]);
    }
    expect(store.saves).toBe(1);
    // Its content still counts: an edit is read, parsed and stored.
    files.put('Notes/Plan.md', '# Plan\nEdited ahead of time. #ahead\n', 'future 2', files.checkedAtMs + 365 * 86_400_000);
    expect((await invocation()).cache.getFileCache('Notes/Plan.md')?.tags?.map(tag => tag.tag)).toEqual(['#ahead']);
    expect(store.saves).toBe(2);
  });

  it('reuses parse results across renames, drops deleted files and parses new ones', async () => {
    const { files, store, invocation, fresh } = setup();
    await invocation();
    files.put('Archive/Plan.md', files.files.get('Notes/Plan.md')!);
    files.files.delete('Notes/Plan.md'); files.stamps.delete('Notes/Plan.md');
    files.files.delete('Bad.md'); files.stamps.delete('Bad.md');
    files.put('New.md', 'Links [[Plan]].\n');
    const next = await invocation();
    expect(next.reads).toEqual(['Archive/Plan.md', 'New.md']);
    expect(next.parsed).toEqual(['New.md']);
    expect(metadataState(next.cache)).toEqual(await fresh());
    expect(next.cache.resolvedLinks['New.md']).toEqual({ 'Archive/Plan.md': 1 });
    expect(Object.keys((store.stored as MetadataSnapshot).files).sort()).toEqual(['Archive/Plan.md', 'Board.canvas', 'New.md', 'Notes/Ideas.md']);
  });

  it('ignores a missing, foreign, malformed or unreadable snapshot and rebuilds', async () => {
    const { store, invocation, fresh } = setup();
    await invocation();
    const good = store.stored as MetadataSnapshot;
    for (const stored of [{ ...good, key: 'forge other' }, { ...good, format: 99 }, { ...good, files: 'x' }, 'garbage', null]) {
      store.stored = stored;
      const rebuilt = await invocation();
      expect(rebuilt.parsed).toHaveLength(4);
      expect(metadataState(rebuilt.cache)).toEqual(await fresh());
      expect(store.stored).toEqual(expect.objectContaining({ key }));
    }
    store.load = () => Promise.reject(new Error('unreadable'));
    expect((await invocation()).parsed).toHaveLength(4);
  });

  it('stores nothing after a failed load and leaves the failure to the command', async () => {
    const { files, store } = setup();
    const metadata = new VaultMetadata(Object.assign(Object.create(files) as MemoryFiles, { read: () => Promise.reject(new Error('disk gone')) }), countingParser([]), { snapshots: { store, key, save: true } });
    await expect(metadata.load()).rejects.toThrow('disk gone');
    await metadata.persist();
    expect(store.saves).toBe(0);
  });

  it('never saves during a dry run but still reuses a stored snapshot', async () => {
    const { store, invocation } = setup();
    await invocation(false);
    expect(store.saves).toBe(0);
    await invocation();
    expect((await invocation(false)).reads).toEqual([]);
    expect(store.saves).toBe(1);
  });

  it('stores files updated after a commit without a stamp, so the next load re-reads but does not parse them', async () => {
    const { files, store, invocation } = setup();
    const { metadata } = await invocation();
    files.put('Notes/Plan.md', '# Plan\nCommitted change. #done\n');
    await metadata.update([{ path: 'Notes/Plan.md', operation: 'updated' }]);
    await metadata.persist();
    expect((store.stored as MetadataSnapshot).files['Notes/Plan.md']).toEqual({ stamp: null, revision: 'sha:# Plan\nCommitted change. #done\n' });
    const next = await invocation();
    expect(next.reads).toEqual(['Notes/Plan.md']);
    expect(next.parsed).toEqual([]);
    expect(next.cache.getFileCache('Notes/Plan.md')?.tags?.map(tag => tag.tag)).toEqual(['#done']);
  });

  it('answers parseFile from a stored result of the same revision without building the index', async () => {
    const { files, store, invocation } = setup();
    await invocation();
    const parsed: string[] = [];
    const metadata = new VaultMetadata(files, countingParser(parsed), { workspaceRoot: true, snapshots: { store, key, save: true }, revisionOf });
    files.reads.length = 0;
    const plan = await files.read('Notes/Plan.md');
    expect((await metadata.parseFile(plan))?.tags?.map(tag => tag.tag)).toEqual(['#plan']);
    expect(await metadata.parseFile(await files.read('Bad.md'))).toBeNull();
    expect(parsed).toEqual([]);
    // Other content at the same path is parsed, and nothing beyond the files passed in is read.
    expect((await metadata.parseFile({ path: 'Notes/Plan.md', bytes: new TextEncoder().encode('# New #fresh\n') }))?.tags?.map(tag => tag.tag)).toEqual(['#fresh']);
    expect(parsed).toEqual(['Notes/Plan.md']);
    expect(files.reads).toEqual(['Notes/Plan.md', 'Bad.md']);
  });

  it('derives the parseFile revision from the bytes, so planned content never gets the stored metadata', async () => {
    const { files, store, invocation } = setup();
    const { metadata: loaded } = await invocation();
    const unloaded = new VaultMetadata(files, countingParser([]), { workspaceRoot: true, snapshots: { store, key, save: true }, revisionOf });
    const read = await files.read('Notes/Plan.md');
    // A plugin previews planned content and keeps the read snapshot's revision by spreading it.
    const planned = { ...read, bytes: new TextEncoder().encode('# Plan\nPlanned. #planned\n') };
    for (const index of [unloaded, loaded]) expect((await index.parseFile(planned))?.tags?.map(tag => tag.tag)).toEqual(['#planned']);
  });
});
