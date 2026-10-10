import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { NodeFiles, revisionOf } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ScopedFiles } from '../../src/application/workspace/scoped-files.ts';
import type { CommittedBatch } from '../../src/application/workspace/ports.ts';

let root: string, files: NodeFiles;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-batch-')); files = await NodeFiles.at(root); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

const rev = (text: string) => revisionOf(encodeText(text));
async function put(entries: Record<string, string>) {
  for (const [path, text] of Object.entries(entries)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
}
async function walk(directory = root, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) { result.push(prefix + entry.name); continue; }
    const nested = await walk(join(directory, entry.name), `${prefix}${entry.name}/`);
    // Empty folders stay visible, so tests see folders a rollback left behind.
    result.push(...(nested.length ? nested : [`${prefix}${entry.name}/`]));
  }
  return result.sort();
}
type Adapter = { replace(target: string, ...args: unknown[]): Promise<void> };
function failWritesTo(name: string) {
  const adapter = files as unknown as Adapter;
  const replace = adapter.replace.bind(files);
  vi.spyOn(adapter, 'replace').mockImplementation(async (target, ...args) => {
    if (basename(target) === name) throw new Error('Injected write failure');
    await replace(target, ...args);
  });
}

describe('guarded batches with renames and removals', () => {
  it('moves a file into new folders and rewrites it and a referrer in one batch', async () => {
    await put({ 'notes/Old.md': 'Old body', 'Index.md': 'See [[Old]]' });
    const result = await files.commit({
      renames: [{ from: 'notes/Old.md', to: 'archive/2026/New.md', expectedRevision: rev('Old body') }],
      writes: [{ path: 'archive/2026/New.md', bytes: encodeText('New body'), expectedRevision: rev('Old body') }, { path: 'Index.md', bytes: encodeText('See [[New]]'), expectedRevision: rev('See [[Old]]') }],
    }, false);
    expect(result).toEqual({
      renames: [{ from: 'notes/Old.md', to: 'archive/2026/New.md', kind: 'file', revision: rev('Old body'), bytes: 8 }],
      changes: [
        { path: 'archive/2026/New.md', revision: rev('New body'), operation: 'updated', bytes: 8 },
        { path: 'Index.md', revision: rev('See [[New]]'), operation: 'updated', bytes: 11 },
      ],
      folders: ['archive', 'archive/2026'], removedFolders: [],
    });
    expect(await walk()).toEqual(['Index.md', 'archive/2026/New.md', 'notes/']);
    expect(await readFile(join(root, 'archive/2026/New.md'), 'utf8')).toBe('New body');
  });

  it('checks every source, destination and revision before changing anything', async () => {
    await put({ 'a.md': 'A', 'b.md': 'B' });
    const move = (expectedRevision: string, to = 'c.md') => files.commit({ renames: [{ from: 'a.md', to, expectedRevision }] }, false);
    await expect(move(rev('B'))).rejects.toMatchObject({ code: 'CONFLICT', details: { path: 'a.md', expectedRevision: rev('B'), currentRevision: rev('A') } });
    await expect(move(rev('A'), 'b.md')).rejects.toMatchObject({ code: 'DESTINATION_EXISTS', exitCode: 2, details: { path: 'b.md', from: 'a.md' } });
    await expect(files.commit({ renames: [{ from: 'missing.md', to: 'c.md', expectedRevision: rev('A') }] }, false)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(move(rev('A'), 'b.md/inside.md')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    for (const batch of [
      { renames: [{ from: 'a.md', to: 'a.md', expectedRevision: rev('A') }] },
      { renames: [{ from: 'a.md', to: 'c.md', expectedRevision: rev('A') }], writes: [{ path: 'a.md', bytes: encodeText('x') }] },
      { renames: [{ from: 'a.md', to: 'c.md', expectedRevision: rev('A') }, { from: 'b.md', to: 'c.md', expectedRevision: rev('B') }] },
      { renames: [{ from: 'a.md', to: 'c.md', expectedRevision: rev('A') }], removes: [{ path: 'a.md', expectedRevision: rev('A') }] },
      {},
    ]) await expect(files.commit(batch, false)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    expect(await walk()).toEqual(['a.md', 'b.md']);
  });

  it('rolls back renames, rewrites, removals and created folders when a later step fails', async () => {
    await put({ 'notes/Old.md': 'Old', 'Index.md': 'Index', 'Scratch.md': 'Scratch' });
    failWritesTo('Index.md');
    await expect(files.commit({
      renames: [{ from: 'notes/Old.md', to: 'deep/new/New.md', expectedRevision: rev('Old') }],
      writes: [{ path: 'deep/new/New.md', bytes: encodeText('Rewritten'), expectedRevision: rev('Old') }, { path: 'Index.md', bytes: encodeText('Changed'), expectedRevision: rev('Index') }],
      removes: [{ path: 'Scratch.md', expectedRevision: rev('Scratch') }],
    }, false)).rejects.toThrow('Injected write failure');
    expect(await walk()).toEqual(['Index.md', 'Scratch.md', 'notes/Old.md']);
    expect(await readFile(join(root, 'notes/Old.md'), 'utf8')).toBe('Old');
  });

  it('restores a removed file when the batch fails after the removal', async () => {
    await put({ 'Scratch.md': 'Scratch', 'Index.md': 'Index' });
    const adapter = files as unknown as { syncDirectories(directories: Iterable<string>): Promise<void> };
    vi.spyOn(adapter, 'syncDirectories').mockRejectedValueOnce(Object.assign(new Error('EIO: injected'), { code: 'EIO' }));
    await expect(files.commit({ removes: [{ path: 'Scratch.md', expectedRevision: rev('Scratch') }] }, false)).rejects.toMatchObject({ code: 'EIO' });
    expect(await walk()).toEqual(['Index.md', 'Scratch.md']);
  });

  it('renames a file to a new letter case without leaving temporary files', async () => {
    await put({ 'notes/Plan.md': 'Plan' });
    const result = await files.commit({ renames: [{ from: 'notes/Plan.md', to: 'notes/plan.md', expectedRevision: rev('Plan') }] }, false);
    expect(result.renames).toEqual([{ from: 'notes/Plan.md', to: 'notes/plan.md', kind: 'file', revision: rev('Plan'), bytes: 4 }]);
    expect(await walk()).toEqual(['notes/plan.md']);
    expect(await files.read('notes/plan.md')).toMatchObject({ revision: rev('Plan') });
  });

  it('moves and removes folders guarded by their folder revision', async () => {
    await put({ 'docs/a.md': 'A', 'docs/sub/b.md': 'B', 'other.md': 'O' });
    const folder = await files.stat('docs');
    expect(folder).toMatchObject({ path: 'docs', kind: 'folder', files: ['a.md', 'sub/b.md'], folders: ['sub'] });
    expect(await files.stat('other.md')).toEqual({ path: 'other.md', kind: 'file', revision: rev('O'), bytes: 1 });
    await expect(files.stat('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(files.commit({ renames: [{ from: 'docs', to: 'guides', expectedRevision: rev('O') }] }, false)).rejects.toMatchObject({ code: 'CONFLICT' });
    const moved = await files.commit({
      renames: [{ from: 'docs', to: 'guides', expectedRevision: folder.revision }],
      writes: [{ path: 'guides/sub/b.md', bytes: encodeText('B2'), expectedRevision: rev('B') }],
    }, false);
    expect(moved.renames).toEqual([
      { from: 'docs', to: 'guides', kind: 'folder' },
      { from: 'docs/a.md', to: 'guides/a.md', kind: 'file', revision: rev('A'), bytes: 1 },
      { from: 'docs/sub', to: 'guides/sub', kind: 'folder' },
      { from: 'docs/sub/b.md', to: 'guides/sub/b.md', kind: 'file', revision: rev('B'), bytes: 1 },
    ]);
    expect(moved.changes).toEqual([{ path: 'guides/sub/b.md', revision: rev('B2'), operation: 'updated', bytes: 2 }]);
    const guides = await files.stat('guides');
    expect(guides.revision).not.toBe(folder.revision);
    await expect(files.commit({ removes: [{ path: 'guides', expectedRevision: folder.revision }] }, false)).rejects.toMatchObject({ code: 'CONFLICT' });
    const removed = await files.commit({ removes: [{ path: 'guides', expectedRevision: guides.revision }] }, false);
    expect(removed).toMatchObject({ changes: [{ path: 'guides/a.md', operation: 'deleted' }, { path: 'guides/sub/b.md', operation: 'deleted' }], removedFolders: ['guides/sub', 'guides'] });
    expect(await walk()).toEqual(['other.md']);
  });

  it('refuses folders holding a Git repository and keeps remove for files only', async () => {
    await put({ 'repo/.git/HEAD': 'ref', 'repo/a.md': 'A' });
    const folder = await files.stat('repo');
    await expect(files.commit({ removes: [{ path: 'repo', expectedRevision: folder.revision }] }, false)).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(files.remove('repo', folder.revision, false)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(await walk()).toEqual(['repo/.git/HEAD', 'repo/a.md']);
  });

  it('dry runs report the same result and change nothing', async () => {
    await put({ 'a.md': 'A', 'b.md': 'B' });
    const batch = { renames: [{ from: 'a.md', to: 'x/a.md', expectedRevision: rev('A') }], removes: [{ path: 'b.md', expectedRevision: rev('B') }] };
    const preview = await files.commit(batch, true);
    expect(preview).toMatchObject({ renames: [{ from: 'a.md', to: 'x/a.md' }], changes: [{ path: 'b.md', operation: 'deleted' }], folders: [] });
    expect(await walk()).toEqual(['a.md', 'b.md']);
  });

  it('maps project-relative batches and results through a scoped repository', async () => {
    await put({ 'src/alpha/a.md': 'A' });
    const project = new ScopedFiles(files, 'src/alpha');
    expect(await project.stat('a.md')).toMatchObject({ path: 'a.md', kind: 'file' });
    expect(await project.commit({ renames: [{ from: 'a.md', to: 'notes/b.md', expectedRevision: rev('A') }] }, false)).toEqual({
      renames: [{ from: 'a.md', to: 'notes/b.md', kind: 'file', revision: rev('A'), bytes: 1 }], changes: [], folders: ['notes'], removedFolders: [],
    });
    expect(await walk()).toEqual(['src/alpha/notes/b.md']);
  });
});

describe('workspace events for mixed batches', () => {
  async function workspace() {
    const events = new EventBus(new NodeEventScope());
    registerHostEvents(events);
    const observed: CommittedBatch[] = [];
    const space = new Workspace(files, new ObsidianDocuments(), events, false, root, { committed: async batch => { observed.push(batch); } });
    return { events, observed, space };
  }
  const vault = (events: EventBus) => events.history.filter(record => record.id.startsWith('vault.')).map(record => [record.id, record.payload]);

  it('publishes folder creation, renames, then file changes and passes file renames to the observer', async () => {
    await put({ 'docs/a.md': 'A', 'Index.md': 'I' });
    const { events, observed, space } = await workspace();
    const folder = await files.stat('docs');
    await space.commit({ renames: [{ from: 'docs', to: 'archive/docs', expectedRevision: folder.revision }], writes: [{ path: 'Index.md', bytes: encodeText('I2'), expectedRevision: rev('I') }] }, { operation: 'move' });
    expect(vault(events)).toEqual([
      ['vault.create', { path: 'archive', kind: 'folder', operation: 'created' }],
      ['vault.rename', { path: 'archive/docs', oldPath: 'docs', kind: 'folder' }],
      ['vault.rename', { path: 'archive/docs/a.md', oldPath: 'docs/a.md', kind: 'file', revision: rev('A') }],
      ['vault.modify', { path: 'Index.md', kind: 'file', revision: rev('I2'), bytes: 2, operation: 'updated' }],
    ]);
    expect(observed).toEqual([{ renames: [{ from: 'docs/a.md', to: 'archive/docs/a.md', kind: 'file', revision: rev('A'), bytes: 1 }], changes: [expect.objectContaining({ path: 'Index.md' })] }]);
    expect(events.history.find(record => record.id === 'operation.succeeded')?.payload).toMatchObject({ operation: 'move', renames: [{ from: 'docs', to: 'archive/docs', kind: 'folder' }, { from: 'docs/a.md', to: 'archive/docs/a.md', kind: 'file' }] });
  });

  it('reports trash moves as deletions without records for the hidden trash folders', async () => {
    await put({ 'docs/a.md': 'A', 'docs/sub/b.md': 'B' });
    const { events, space } = await workspace();
    const folder = await files.stat('docs');
    await space.commit({ renames: [{ from: 'docs', to: '.trash/docs', expectedRevision: folder.revision }] }, { operation: 'delete', trash: ['.trash/docs'] });
    expect(vault(events)).toEqual([
      ['vault.delete', { path: 'docs/a.md', kind: 'file', revision: rev('A'), bytes: 1, operation: 'deleted' }],
      ['vault.delete', { path: 'docs/sub/b.md', kind: 'file', revision: rev('B'), bytes: 1, operation: 'deleted' }],
      ['vault.delete', { path: 'docs/sub', kind: 'folder', operation: 'deleted' }],
      ['vault.delete', { path: 'docs', kind: 'folder', operation: 'deleted' }],
    ]);
    expect(await walk()).toEqual(['.trash/docs/a.md', '.trash/docs/sub/b.md']);
  });
});
