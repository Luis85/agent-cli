import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFiles, revisionOf } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { ScopedFiles } from '../../src/application/workspace/scoped-files.ts';
import type { FileBatch } from '../../src/application/workspace/ports.ts';

let root: string, files: NodeFiles;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-unchanged-')); files = await NodeFiles.at(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const rev = (text: string) => revisionOf(encodeText(text));
const write = (path: string, text: string, expectedRevision?: string) => ({ path, bytes: encodeText(text), ...(expectedRevision === undefined ? {} : { expectedRevision }) });
async function put(entries: Record<string, string>) {
  for (const [path, text] of Object.entries(entries)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

describe('writes of bytes a file already holds', () => {
  it('neither writes nor publishes them, and marks those whose guard did not match', async () => {
    await put({ 'same.md': 'same', 'other.md': 'old' });
    const before = await stat(join(root, 'same.md'));
    const events = new EventBus(new NodeEventScope());
    registerHostEvents(events);
    const committed: unknown[] = [];
    const workspace = new Workspace(files, new ObsidianDocuments(), events, false, root, { async committed(batch) { committed.push(batch); } });
    const result = await workspace.write([write('same.md', 'same', 'stale'), write('other.md', 'new', rev('old'))]);
    expect(result.changes).toEqual([
      { path: 'same.md', revision: rev('same'), operation: 'unchanged', bytes: 4, alreadyApplied: true },
      { path: 'other.md', revision: rev('new'), operation: 'updated', bytes: 3 },
    ]);
    expect((await stat(join(root, 'same.md'))).mtimeMs).toBe(before.mtimeMs);
    expect(events.history.filter(record => record.id.startsWith('vault.')).map(record => record.id)).toEqual(['vault.modify']);
    expect(committed).toEqual([{ renames: [], changes: [expect.objectContaining({ path: 'other.md' })] }]);
    // A matching guard on unchanged bytes is a plain no-op, without alreadyApplied.
    expect((await workspace.write([write('same.md', 'same', rev('same'))])).changes).toEqual([{ path: 'same.md', revision: rev('same'), operation: 'unchanged', bytes: 4 }]);
    const preview = new Workspace(files, new ObsidianDocuments(), events, true);
    expect((await preview.write([write('same.md', 'same')], { diff: true })).changes).toEqual([{ path: 'same.md', revision: rev('same'), operation: 'unchanged', bytes: 4, alreadyApplied: true, diff: '' }]);
  });

  it('marks a stale edit whose change the file already holds, and refuses it', async () => {
    await put({ 'note.md': 'done' });
    const workspace = new Workspace(files, new ObsidianDocuments(), new EventBus(new NodeEventScope()), false);
    const replace = (from: string, to: string) => (bytes: Uint8Array) => encodeText(new TextDecoder().decode(bytes).replace(from, to));
    await expect(workspace.edit('note.md', 'stale', replace('todo', 'done'))).rejects.toMatchObject({
      code: 'CONFLICT', message: 'File changed since it was read: note.md, but it already holds the requested change; nothing was written. Continue from its currentRevision.',
      details: { path: 'note.md', expectedRevision: 'stale', currentRevision: rev('done'), alreadyApplied: true },
    });
    const failure = await workspace.edit('note.md', 'stale', () => { throw new Error('does not apply'); }).then(() => undefined, (error: unknown) => error as { details: Record<string, unknown> });
    expect(failure?.details).toEqual({ path: 'note.md', expectedRevision: 'stale', currentRevision: rev('done') });
  });
});

describe('dry-run folders', () => {
  it('lists the folders a commit creates, in its order, also for writes into a moved folder', async () => {
    await put({ 'src/a.md': 'A', 'src/sub/b.md': 'B', 'loose.md': 'L' });
    const folder = await files.stat('src');
    const batch: FileBatch = {
      renames: [{ from: 'src', to: 'archive/2026/src', expectedRevision: folder.revision }, { from: 'loose.md', to: 'kept/loose.md', expectedRevision: rev('L') }],
      writes: [write('archive/2026/src/sub/deep/c.md', 'C'), write('archive/2026/src/sub/d.md', 'D'), write('new/e.md', 'E'), write('archive/2026/f.md', 'F')],
    };
    const preview = await files.commit(batch, true);
    expect(preview.folders).toEqual(['archive', 'archive/2026', 'kept', 'new', 'archive/2026/src/sub/deep']);
    expect(await files.commit(batch, false)).toEqual(preview);
  });

  it('reports scoped folders relative to the project in dry runs and commits alike', async () => {
    await put({ 'projects/demo/a.md': 'A' });
    const project = new ScopedFiles(files, 'projects/demo');
    const batch: FileBatch = { renames: [{ from: 'a.md', to: 'x/y/a.md', expectedRevision: rev('A') }] };
    const preview = await project.commit(batch, true);
    expect(preview.folders).toEqual(['x', 'x/y']);
    expect(await project.commit(batch, false)).toEqual(preview);
  });
});

describe('failures inside a project scope', () => {
  it('name paths relative to the project in messages and details', async () => {
    await put({ 'projects/demo/a.md': 'A' });
    const project = new ScopedFiles(files, 'projects/demo');
    await expect(project.read('missing.md')).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'File not found: missing.md', details: { path: 'missing.md' } });
    await expect(project.stat('gone')).rejects.toMatchObject({ message: 'File or folder not found: gone', details: { path: 'gone' } });
    await expect(project.writeBatch([write('a.md', 'B'), write('b.md', 'B', 'stale')], false)).rejects.toMatchObject({
      code: 'CONFLICT', message: 'File already exists: a.md. Replace it with write --if-match and its currentRevision, or change it with edit. Conflicting paths: a.md, b.md.',
      details: { path: 'a.md', conflicts: [{ path: 'a.md' }, { path: 'b.md' }] },
    });
    await expect(project.commit({ renames: [{ from: 'a.md', to: 'b.md', expectedRevision: 'stale' }], removes: [{ path: 'nope.md', expectedRevision: 'x' }] }, false)).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'File not found: nope.md', details: { path: 'nope.md' } });
  });
});
