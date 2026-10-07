import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFiles } from '../src/infrastructure/files.ts';
import { ObsidianDocuments, encodeText } from '../src/infrastructure/documents.ts';
import { EventBus } from '../src/application/events.ts';
import { Workspace } from '../src/application/workspace.ts';
let root: string, files: NodeFiles;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'agent-files-')); files = await NodeFiles.at(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const write = (path: string, text = 'Hello') => ({ path, bytes: encodeText(text) });

describe('guarded filesystem', () => {
  it('creates, reads and updates with optimistic revisions', async () => {
    await files.writeBatch([write('notes/a.md')], false);
    const before = await files.read('notes/a.md');
    await expect(files.writeBatch([write('notes/a.md')], false)).rejects.toMatchObject({ code: 'CONFLICT' });
    await files.writeBatch([{ ...write('notes/a.md', 'Changed'), expectedRevision: before.revision }], false);
    await expect(files.writeBatch([{ ...write('notes/a.md'), expectedRevision: before.revision }], false)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(join(root, 'notes/a.md'), 'utf8')).toBe('Changed');
  });
  it('dry runs leave no files, directories or lock', async () => {
    expect(await files.writeBatch([write('new/deep/note.md')], true)).toMatchObject([{ operation: 'created' }]);
    expect(await readdir(root)).toEqual([]);
  });
  it('preflights all collisions before writing a batch', async () => {
    await writeFile(join(root, 'existing.md'), 'Old');
    await expect(files.writeBatch([write('first.md'), write('existing.md')], false)).rejects.toThrow();
    expect(await readdir(root)).toEqual(['existing.md']);
    await expect(files.writeBatch([write('a'), write('a/b.md')], false)).rejects.toThrow();
  });
  it.each(['../escape.md', '/absolute.md', 'a/../escape.md', 'a\\b.md', '.git/config', 'C:/escape.md', '.agent-cli.lock'])('rejects unsafe path %s', async path => {
    await expect(files.writeBatch([write(path)], false)).rejects.toThrow();
  });
  it('rejects symlinked files and directories and skips them in listing', async () => {
    await symlink(tmpdir(), join(root, 'outside'));
    await symlink(join(root, 'missing'), join(root, 'alias.md'));
    await expect(files.read('outside/file')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(files.writeBatch([write('alias.md')], false)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await files.list()).toEqual([]);
  });
  it('reports an existing writer lock without removing it', async () => {
    await writeFile(join(root, '.agent-cli.lock'), '');
    await expect(files.writeBatch([write('a.md')], false)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
    expect(await readdir(root)).toEqual(['.agent-cli.lock']);
  });
  it('publishes only committed changes, and no event on validation/write failure or dry run', async () => {
    const events = new EventBus();
    events.define({ id: 'file.created', validate: (v): v is object => typeof v === 'object' });
    const listener = vi.fn(async () => { expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('Hello'); });
    events.on('file.created', listener);
    await new Workspace(files, new ObsidianDocuments(), events, true).write([write('note.md')]);
    expect(listener).not.toHaveBeenCalled();
    const workspace = new Workspace(files, new ObsidianDocuments(), events, false);
    await expect(workspace.write([write('bad.canvas', '{"nodes":42}')])).rejects.toThrow();
    await workspace.write([write('note.md')]);
    await expect(workspace.write([write('note.md')])).rejects.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
