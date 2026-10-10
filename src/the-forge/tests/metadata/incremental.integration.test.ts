import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { ScopedFiles } from '../../src/application/workspace/scoped-files.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { writeSyntheticVault } from '../support/bases-vault.ts';
import { metadataIndex, metadataState } from '../support/metadata.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-metadata-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const board = (file: string) => JSON.stringify({ nodes: [{ id: 'n1', type: 'file', file, subpath: '#Note 3', x: 0, y: 0, width: 100, height: 100 }], edges: [] });

/** A workspace whose committed batches update the metadata index of the same scope, as the composition root binds it. */
async function vault(directory: string) {
  const events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  const nodeFiles = await NodeFiles.at(root);
  const files = directory ? new ScopedFiles(nodeFiles, directory) : nodeFiles;
  const index = metadataIndex(files), reports: unknown[] = [];
  const workspace = new Workspace(files, new ObsidianDocuments(), events, false, null, { committed: async ({ changes }) => { reports.push(await index.update(changes)); } });
  return { workspace, index, files, reports };
}

describe('kernel metadata cache over a filesystem vault', () => {
  it.each(['', 'projects/vault'])('keeps an incrementally updated cache equal to a full rebuild after committed writes (scope "%s")', async directory => {
    const base = join(root, directory);
    await writeSyntheticVault(base, { notes: 40, attachments: 12 });
    await mkdir(join(base, 'Boards'), { recursive: true });
    await writeFile(join(base, 'Boards/Map.canvas'), board('Areas/Area 3/Note 3.md'));
    const { workspace, index, files, reports } = await vault(directory);
    const cache = await index.load();
    expect(cache.resolvedLinks['Boards/Map.canvas']).toEqual({ 'Areas/Area 3/Note 3.md': 1 });
    expect(cache.unresolvedLinks['Areas/Area 0/Note 0.md']).toEqual({ 'Missing 0': 1 });
    const revision = async (path: string) => (await files.read(path)).revision;

    await workspace.write([
      { path: 'Missing 0.md', bytes: encodeText('---\naliases: [Zero]\n---\n# Found\nSee [[Zero]] and [[Note 1#Heading|one]].\n') },
      { path: 'Areas/Area 1/Note 1.md', bytes: encodeText('# Rewritten\n[[Note 2]] ![[image 1.png]] #fresh\n'), expectedRevision: await revision('Areas/Area 1/Note 1.md') },
      { path: 'Boards/Map.canvas', bytes: encodeText(board('Missing 0.md')), expectedRevision: await revision('Boards/Map.canvas') },
    ]);
    // Deleting a target re-resolves exactly the sources that linked to it.
    const linking = (path: string) => [...new Set(cache.backlinks(path).map(item => item.source))];
    const imageSources = linking('Assets/image 3.png'), noteSources = linking('Areas/Area 2/Note 2.md');
    expect(imageSources.length).toBeGreaterThan(1);
    expect(noteSources).toContain('Areas/Area 1/Note 1.md');
    await workspace.remove('Assets/image 3.png', await revision('Assets/image 3.png'));
    await workspace.remove('Areas/Area 2/Note 2.md', await revision('Areas/Area 2/Note 2.md'));

    expect(metadataState(cache)).toEqual(metadataState(await metadataIndex(files).load()));
    expect(cache.backlinks('Missing 0.md').map(item => [item.source, item.kind])).toEqual([
      ['Areas/Area 0/Note 0.md', 'link'], ['Areas/Area 14/Note 34.md', 'link'], ['Boards/Map.canvas', 'canvas'],
    ]);
    expect(cache.resolvedLinks['Missing 0.md']).toEqual({ 'Missing 0.md': 1, 'Areas/Area 1/Note 1.md': 1 });
    expect(cache.unresolvedLinks['Areas/Area 1/Note 1.md']).toEqual({ 'Note 2': 1 });
    // One report per committed batch: the three-file write re-indexes its files together.
    expect(reports).toEqual([
      {
        changed: ['Areas/Area 1/Note 1.md', 'Boards/Map.canvas', 'Missing 0.md'], deleted: [],
        resolved: ['Areas/Area 0/Note 0.md', 'Areas/Area 1/Note 1.md', 'Areas/Area 14/Note 34.md', 'Boards/Map.canvas', 'Missing 0.md'], prevCaches: {},
      },
      { changed: [], deleted: ['Assets/image 3.png'], resolved: imageSources, prevCaches: { 'Assets/image 3.png': null } },
      { changed: [], deleted: ['Areas/Area 2/Note 2.md'], resolved: noteSources, prevCaches: { 'Areas/Area 2/Note 2.md': expect.objectContaining({ links: expect.any(Array) }) } },
    ]);
  });
});
