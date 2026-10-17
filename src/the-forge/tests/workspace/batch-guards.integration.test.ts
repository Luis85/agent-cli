import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { writerLockName as lockName } from '../../src/domain/documents/file.ts';
import { ScopedFiles } from '../../src/application/workspace/scoped-files.ts';
import { StagedFiles } from '../../src/application/documents/staged-files.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { snapshotBatch } from '../../src/application/workspace/batch-plan.ts';
import type { FileBatch } from '../../src/application/workspace/ports.ts';

let root: string, files: NodeFiles;
const bytes = (text: string) => new TextEncoder().encode(text);
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-guards-')); files = await NodeFiles.at(root); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
async function put(path: string, text: string) {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), text);
}

describe('check-only batch guards', () => {
  it.each([false, true])('rejects an added file in a guarded folder before mutation (dry-run %s)', async dryRun => {
    await put('installed/index.html', 'old');
    await put('installed/obsolete.js', 'old asset');
    const folder = await files.stat('installed'), index = await files.read('installed/index.html'), obsolete = await files.read('installed/obsolete.js');
    await put('installed/foreign.txt', 'keep');
    const currentRevision = (await files.stat('installed')).revision;
    const stage = vi.spyOn(files, 'stageAll');
    await expect(files.commit({
      guards: [{ path: 'installed', expectedRevision: folder.revision }],
      writes: [{ path: index.path, expectedRevision: index.revision, bytes: bytes('new') }, { path: 'new/folder/asset.js', bytes: bytes('new asset') }],
      removes: [{ path: obsolete.path, expectedRevision: obsolete.revision }],
    }, dryRun)).rejects.toMatchObject({ code: 'CONFLICT', details: { path: 'installed', expectedRevision: folder.revision, currentRevision } });
    expect(stage).not.toHaveBeenCalled();
    expect(await files.read(index.path)).toEqual(index);
    expect(await files.read(obsolete.path)).toEqual(obsolete);
    expect(await files.list()).toEqual(['installed/foreign.txt', 'installed/index.html', 'installed/obsolete.js']);
    expect(await readdir(root)).toEqual(['installed']);
  });

  it.each([false, true])('rejects an unexpectedly created destination folder (dry-run %s)', async dryRun => {
    const plan = { guards: [{ path: 'installed' }], writes: [{ path: 'installed/index.html', bytes: bytes('new') }] };
    await mkdir(join(root, 'installed'));
    await expect(files.commit(plan, dryRun)).rejects.toMatchObject({ code: 'CONFLICT', details: { path: 'installed', expectedRevision: null } });
    expect(await readdir(join(root, 'installed'))).toEqual([]);
    expect(await readdir(root)).toEqual(['installed']);
  });

  it('checks guards after taking the writer lock and detaches caller-owned conditions', async () => {
    await put('source/input.txt', 'source');
    const source = await files.stat('source');
    const guards = [{ path: 'source', expectedRevision: source.revision }];
    const folder = files.folder.bind(files);
    vi.spyOn(files, 'folder').mockImplementation(async path => {
      expect(existsSync(join(root, lockName))).toBe(true);
      return folder(path);
    });
    const result = files.commit({ guards, writes: [{ path: 'installed/index.html', bytes: bytes('built') }] }, false);
    guards[0]!.expectedRevision = 'changed by caller';
    guards[0]!.path = 'elsewhere';
    expect((await result).changes).toMatchObject([{ path: 'installed/index.html', operation: 'created' }]);
    expect(existsSync(join(root, lockName))).toBe(false);
  });

  it('allows unchanged guard-only batches and a dry-run without creating any state', async () => {
    await put('installed/index.html', 'unchanged');
    const file = await files.read('installed/index.html'), folder = await files.stat('installed');
    const batch = { guards: [{ path: 'installed', expectedRevision: folder.revision }, { path: file.path, expectedRevision: file.revision }, { path: 'absent' }] };
    const expected = { renames: [], changes: [], folders: [], removedFolders: [] };
    expect(await files.commit(batch, true)).toEqual(expected);
    expect(await files.commit(batch, false)).toEqual(expected);
    expect(await files.read(file.path)).toEqual(file);
    expect(await readdir(root)).toEqual(['installed']);
    expect(await readdir(join(root, 'installed'))).toEqual(['index.html']);
    await expect(files.commit({}, false)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  });

  it('checks a file revision and maps scoped guard paths alongside writes', async () => {
    await put('project/source/input.txt', 'source');
    const scoped = new ScopedFiles(files, 'project'), source = await scoped.stat('source');
    await scoped.commit({ guards: [{ path: 'source', expectedRevision: source.revision }, { path: 'dist' }], writes: [{ path: 'dist/index.html', bytes: bytes('built') }] }, false);
    await expect(scoped.commit({ guards: [{ path: 'dist/index.html', expectedRevision: 'stale' }], writes: [{ path: 'other.txt', bytes: bytes('bad') }] }, false)).rejects.toMatchObject({ code: 'CONFLICT', message: 'Guarded paths changed; read again before modifying: dist/index.html', details: { path: 'dist/index.html' } });
    expect(await scoped.list()).toEqual(['dist/index.html', 'source/input.txt']);
  });

  it('validates guard plans, including sparse arrays, before filesystem work', async () => {
    for (const guards of [{}, [null], Array(1), [{}], [{ path: 'valid', expectedRevision: 42 }]]) {
      await expect(files.commit({ guards, writes: [{ path: 'new.txt', bytes: bytes('new') }] } as unknown as FileBatch, false)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    }
    const guards = [{ path: 'safe', expectedRevision: 'revision' }], snapshot = snapshotBatch({ guards });
    guards[0]!.expectedRevision = 'mutated';
    expect(snapshot.guards).toEqual([{ path: 'safe', expectedRevision: 'revision' }]);
    expect(await readdir(root)).toEqual([]);
  });

  it('emits no vault changes or commit observation for unchanged guard-only work', async () => {
    await put('installed/index.html', 'unchanged');
    const folder = await files.stat('installed'), events = new EventBus(new NodeEventScope()), committed = vi.fn();
    registerHostEvents(events);
    const workspace = new Workspace(files, new ObsidianDocuments(), events, false, root, { committed });
    expect(await workspace.commit({ guards: [{ path: 'installed', expectedRevision: folder.revision }] }, { operation: 'apply' })).toMatchObject({ changes: [], renames: [], folders: [], removedFolders: [] });
    expect(events.history.filter(event => event.id.startsWith('vault.'))).toEqual([]);
    expect(committed).not.toHaveBeenCalled();
  });

  it('enforces guards before changing an in-memory plan', async () => {
    await put('source/input.txt', 'source');
    const staged = new StagedFiles(files), source = await staged.stat('source');
    await staged.commit({ guards: [{ path: 'source', expectedRevision: source.revision }, { path: 'new' }], writes: [{ path: 'new/file.txt', bytes: bytes('planned') }] });
    await expect(staged.commit({ guards: [{ path: 'new' }], writes: [{ path: 'other.txt', bytes: bytes('bad') }] })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await staged.list()).toEqual(['new/file.txt', 'source/input.txt']);
    expect(await files.list()).toEqual(['source/input.txt']);
  });
});
