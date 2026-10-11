import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/application/vault/app.ts';
import type { Workspace } from '../../src/application/workspace/workspace.ts';
import type { MetadataCache, MetadataIndex } from '../../src/application/metadata/ports.ts';
import type { EventChannel } from '../../src/application/plugins/events.ts';

const text = (value: string) => new TextEncoder().encode(value);
const change = (path: string) => ({ path, revision: 'new', operation: 'updated' as const, bytes: 3 });

function scope() {
  const files = { read: vi.fn(async (path: string) => ({ path, bytes: text('old'), revision: 'r1' })), stat: vi.fn() };
  const workspace = {
    files, dryRun: false,
    write: vi.fn(async (writes: Array<{ path: string }>) => ({ dryRun: false, changes: writes.map(write => change(write.path)) })),
    edit: vi.fn(async (path: string, _revision: string, transform: (bytes: Uint8Array) => Uint8Array) => { transform(text('old')); return { dryRun: false, changes: [change(path)] }; }),
  };
  const cache = {
    files: () => ['a.md', 'b.png', 'c.md'],
    getFileCache: () => ({ links: [{ link: 'x', original: '[[x]]' }] }),
    getFirstLinkpathDest: vi.fn(() => 'c.md'),
    fileToLinktext: vi.fn(() => 'c'),
    resolvedLinks: { 'a.md': { 'c.md': 1 } },
    unresolvedLinks: { 'a.md': {} },
  } as unknown as MetadataCache;
  const metadata = { load: vi.fn(async () => cache) } as unknown as MetadataIndex;
  const events = { on: vi.fn(() => () => {}), onLayoutReady: vi.fn() } as unknown as EventChannel;
  const project = { schemaVersion: 1 as const, name: 'alpha', type: 'library' as const, directory: 'src/alpha' };
  const app = createApp({ workspace: workspace as unknown as Workspace, metadata, events, project });
  return { app, files, workspace, cache, metadata, events, project };
}

describe('the app facade', () => {
  it('reads text and guards vault mutations with the caller revision or the one just read', async () => {
    const { app, workspace } = scope();
    expect(await app.vault.read('a.md')).toBe('old');
    expect(await app.vault.create('n.md', 'new')).toEqual(change('n.md'));
    expect(workspace.write).toHaveBeenLastCalledWith([{ path: 'n.md', bytes: text('new') }]);
    await app.vault.modify('a.md', 'new');
    expect(workspace.write).toHaveBeenLastCalledWith([{ path: 'a.md', bytes: text('new'), expectedRevision: 'r1' }]);
    await app.vault.modify('a.md', text('new'), { ifMatch: 'mine' });
    expect(workspace.write).toHaveBeenLastCalledWith([{ path: 'a.md', bytes: text('new'), expectedRevision: 'mine' }]);
    expect(await app.vault.process('a.md', data => `${data}!`)).toBe('old!');
    expect(workspace.edit).toHaveBeenLastCalledWith('a.md', 'r1', expect.any(Function));
    await app.vault.append('a.md', ' more', { ifMatch: 'mine' });
    expect(workspace.edit).toHaveBeenLastCalledWith('a.md', 'mine', expect.any(Function));
    await expect(app.vault.process('a.md', () => 42 as unknown as string)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('maps low-level vault moves and deletions to the file manager without link handling', async () => {
    const { app } = scope();
    const move = vi.spyOn(app.fileManager, 'move').mockResolvedValue({} as never);
    const remove = vi.spyOn(app.fileManager, 'delete').mockResolvedValue({} as never);
    await app.vault.rename('a.md', 'z.md', { ifMatch: 'r' });
    expect(move).toHaveBeenCalledWith('a.md', 'z.md', { ifMatch: 'r', updateLinks: false });
    await app.fileManager.renameFile('a.md', 'z.md');
    expect(move).toHaveBeenLastCalledWith('a.md', 'z.md', { updateLinks: true });
    await app.vault.trash('a.md');
    expect(remove).toHaveBeenLastCalledWith('a.md', { recursive: true, allowBrokenLinks: true });
    await app.vault.delete('a.md', { ifMatch: 'r' });
    expect(remove).toHaveBeenLastCalledWith('a.md', { ifMatch: 'r', permanent: true, allowBrokenLinks: true });
    await app.fileManager.trashFile('a.md');
    expect(remove).toHaveBeenLastCalledWith('a.md', { recursive: true });
  });

  it('answers metadata questions from the loaded cache with detached copies', async () => {
    const { app, cache } = scope();
    expect(await app.vault.getFiles()).toEqual(['a.md', 'b.png', 'c.md']);
    expect(await app.vault.getMarkdownFiles()).toEqual(['a.md', 'c.md']);
    const metadata = await app.metadataCache.getFileCache('a.md');
    metadata!.links!.length = 0;
    expect(cache.getFileCache('a.md')!.links).toHaveLength(1);
    expect(await app.metadataCache.getFirstLinkpathDest('c', 'a.md')).toBe('c.md');
    expect(await app.metadataCache.fileToLinktext('c.md', 'a.md', false)).toBe('c');
    expect(cache.fileToLinktext).toHaveBeenCalledWith('c.md', 'a.md', false);
    const resolved = await app.metadataCache.resolvedLinks();
    resolved['a.md']!['c.md'] = 9;
    expect(cache.resolvedLinks['a.md']).toEqual({ 'c.md': 1 });
    expect(await app.metadataCache.unresolvedLinks()).toEqual({ 'a.md': {} });
  });

  it('subscribes to host events by their Obsidian names and exposes the active project', async () => {
    const { app, events, project } = scope();
    const callback = () => {};
    app.vault.on('rename', callback);
    app.metadataCache.on('resolved', callback);
    app.workspace.on('file-open', callback);
    app.workspace.onLayoutReady(callback);
    expect(vi.mocked(events.on).mock.calls.map(([id]) => id)).toEqual(['vault.rename', 'metadataCache.resolved', 'workspace.file-open']);
    expect(events.onLayoutReady).toHaveBeenCalledWith(callback);
    expect(app.workspace.getActiveProject()).toEqual(project);
    expect(app.workspace.getActiveProject()).not.toBe(project);
  });
});
