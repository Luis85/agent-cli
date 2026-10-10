import { describe, expect, it } from 'vitest';
import { MetadataCacheEvents } from '../../src/application/metadata/cache-events.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { scopedCommitObserver } from '../../src/application/workspace/scoped-files.ts';
import type { FileChange } from '../../src/domain/documents/file.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { MemoryFiles, metadataIndex } from '../support/metadata.ts';

const vault = () => new MemoryFiles({
  'Notes/Plan.md': '# Plan\nSee [[Ideas]] and [[Missing]].\n',
  'Notes/Ideas.md': '---\naliases: [Brainstorm]\n---\nBack to [[Plan]] and [[Target]].\n',
  'A/Target.md': '# A', 'B/Target.md': '# B', 'Bad.md': '---\nx: [\n---\n',
});
const change = (path: string, operation: FileChange['operation']): FileChange => ({ path, operation, revision: 'r', bytes: 1 });

function publisher(files: MemoryFiles) {
  const events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  const index = metadataIndex(files);
  return { events, index, observer: new MetadataCacheEvents(events, index) };
}

describe('metadataCache events after a committed batch', () => {
  it('publishes nothing and builds no index before the first load', async () => {
    const files = vault();
    const { events, observer } = publisher(files);
    files.files.set('Notes/Plan.md', '[[Ideas]]');
    await observer.committed({ renames: [], changes: [change('Notes/Plan.md', 'updated')] });
    expect(events.history).toEqual([]);
  });

  it('publishes changed, deleted, resolve and resolved in that order with JSON payloads', async () => {
    const files = vault();
    const { events, index, observer } = publisher(files);
    const prevCache = JSON.parse(JSON.stringify((await index.load()).getFileCache('B/Target.md'))) as unknown;
    files.files.set('Missing.md', '# Found');
    files.files.set('Notes/Ideas.md', 'Only [[Plan]] now.');
    files.files.set('Bad.md', '---\ny: [\n---\n');
    files.files.delete('B/Target.md');
    await observer.committed({ renames: [], changes: [change('Notes/Ideas.md', 'updated'), change('Missing.md', 'created'), change('Bad.md', 'updated'), change('B/Target.md', 'deleted')] });

    // Unparseable Bad.md was re-read but has no cache, so it has no changed record and no resolution.
    expect(events.history.map(record => [record.id, (record.payload as { path?: string }).path])).toEqual([
      ['metadataCache.changed', 'Missing.md'], ['metadataCache.changed', 'Notes/Ideas.md'],
      ['metadataCache.deleted', 'B/Target.md'],
      ['metadataCache.resolve', 'Missing.md'], ['metadataCache.resolve', 'Notes/Ideas.md'], ['metadataCache.resolve', 'Notes/Plan.md'],
      ['metadataCache.resolved', undefined],
    ]);
    const cache = (await index.load()).getFileCache('Notes/Ideas.md');
    expect(events.history[1]!.payload).toEqual({ path: 'Notes/Ideas.md', cache: JSON.parse(JSON.stringify(cache)) as unknown });
    expect(events.history[2]!.payload).toEqual({ path: 'B/Target.md', prevCache });
    expect(events.history[6]!.payload).toEqual({});
  });

  it('reports a deleted file without metadata with a null prevCache and still closes the batch', async () => {
    const files = new MemoryFiles({ 'Note.md': '![[image.png]]', 'image.png': 'bytes' });
    const { events, index, observer } = publisher(files);
    await index.load();
    files.files.delete('image.png');
    await observer.committed({ renames: [], changes: [change('image.png', 'deleted')] });
    expect(events.history).toEqual([
      { id: 'metadataCache.deleted', payload: { path: 'image.png', prevCache: null } },
      { id: 'metadataCache.resolve', payload: { path: 'Note.md' } },
      { id: 'metadataCache.resolved', payload: {} },
    ]);
  });

  it('maps parent-scope commits into a selected directory and ignores batches outside it', async () => {
    const received: string[][] = [];
    const observer = scopedCommitObserver({ committed: async ({ changes }) => { received.push(changes.map(item => item.path)); } }, 'src/app');
    await observer.committed({ renames: [], changes: [change('bin/data/context.json', 'updated'), change('src/application/x.md', 'created')] });
    await observer.committed({ renames: [], changes: [change('src/app/Note.md', 'created'), change('src/apple/Other.md', 'created'), change('src/app/docs/Spec.md', 'updated')] });
    expect(received).toEqual([['Note.md', 'docs/Spec.md']]);
  });
});
