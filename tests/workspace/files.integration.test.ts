import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, symlink, writeFile, readdir, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WriteRequest } from '../../src/domain/documents/file.ts';
import { NodeFiles, revisionOf } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
let root: string, files: NodeFiles;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'agent-files-')); files = await NodeFiles.at(root); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
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
  it('retains committed evidence and notifications when removing the lock fails', async () => {
    const events = new EventBus(new NodeEventScope());
    events.define({ id: 'file.created', validate: (_value): _value is unknown => true });
    files = await NodeFiles.at(root, message => events.warn(message));
    const adapter = files as unknown as { releaseLock(lock: string): Promise<void> };
    vi.spyOn(adapter, 'releaseLock').mockRejectedValue(new Error('Cleanup denied'));
    const result = await new Workspace(files, new ObsidianDocuments(), events, false).write([write('committed.md')]);
    expect(result.changes).toMatchObject([{ path: 'committed.md', operation: 'created' }]);
    expect(events.history).toMatchObject([{ id: 'file.created', payload: { path: 'committed.md' } }]);
    expect(events.warnings).toEqual([expect.stringContaining('Cleanup denied')]);
    expect(await readFile(join(root, 'committed.md'), 'utf8')).toBe('Hello');
    expect(await readdir(root)).toEqual(['.agent-cli.lock', 'committed.md']);
  });
  it('preserves the primary write failure even when lock cleanup and reporting fail', async () => {
    const warning = vi.fn(() => { throw new Error('Broken diagnostics'); });
    files = await NodeFiles.at(root, warning);
    const adapter = files as unknown as { releaseLock(lock: string): Promise<void> };
    vi.spyOn(adapter, 'releaseLock').mockRejectedValue(new Error('Cleanup denied'));
    await writeFile(join(root, 'existing.md'), 'Original');
    await expect(files.writeBatch([write('existing.md')], false)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Cleanup denied'));
    expect(await readFile(join(root, 'existing.md'), 'utf8')).toBe('Original');
  });
  it('snapshots mutable plugin plans before asynchronous filesystem work', async () => {
    const request = write('original.md', 'Original');
    const requests: WriteRequest[] = [request];
    const operation = files.writeBatch(requests, false);
    request.path = 'changed.md';
    request.bytes.fill(0);
    requests.push(write('extra.md'));
    expect(await operation).toEqual([{ path: 'original.md', revision: revisionOf(encodeText('Original')), operation: 'created', bytes: 8 }]);
    expect(await files.list()).toEqual(['original.md']);
    expect(await readFile(join(root, 'original.md'), 'utf8')).toBe('Original');
  });
  it('preserves existing permissions when replacing files', async () => {
    await writeFile(join(root, 'script.sh'), 'old');
    await chmod(join(root, 'script.sh'), 0o777);
    const before = await files.read('script.sh');
    await files.writeBatch([{ ...write('script.sh', 'new'), expectedRevision: before.revision }], false);
    expect((await stat(join(root, 'script.sh'))).mode & 0o777).toBe(0o777);
  });
  it('rolls back creations and replacements including modes after a later write fails', async () => {
    await writeFile(join(root, 'existing.md'), 'Original');
    await chmod(join(root, 'existing.md'), 0o777);
    const before = await files.read('existing.md');
    const adapter = files as unknown as { replace(target: string, bytes: Uint8Array, mode?: number, verify?: () => Promise<void>): Promise<void> };
    const replace = adapter.replace.bind(files);
    vi.spyOn(adapter, 'replace').mockImplementation(async (target, ...args) => {
      if (target.endsWith('/failure.md')) throw new Error('Injected write failure');
      await replace(target, ...args);
    });
    await expect(files.writeBatch([write('new/deep/a.md'), { ...write('existing.md', 'Changed'), expectedRevision: before.revision }, write('failure.md')], false)).rejects.toThrow('Injected write failure');
    expect(await readdir(root)).toEqual(['existing.md']);
    expect(await readFile(join(root, 'existing.md'), 'utf8')).toBe('Original');
    expect((await stat(join(root, 'existing.md'))).mode & 0o777).toBe(0o777);
  });
  it('rechecks revisions after preflight and rolls back prior writes on conflict', async () => {
    await writeFile(join(root, 'existing.md'), 'Original');
    const before = await files.read('existing.md');
    const adapter = files as unknown as { replace(target: string, bytes: Uint8Array, mode?: number, verify?: () => Promise<void>): Promise<void> };
    const replace = adapter.replace.bind(files);
    vi.spyOn(adapter, 'replace').mockImplementation(async (target, ...args) => {
      if (target.endsWith('/existing.md')) await writeFile(target, 'External edit');
      await replace(target, ...args);
    });
    await expect(files.writeBatch([write('created.md'), { ...write('existing.md', 'Changed'), expectedRevision: before.revision }], false)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readdir(root)).toEqual(['existing.md']);
    expect(await readFile(join(root, 'existing.md'), 'utf8')).toBe('External edit');
  });
  it('keeps external edits if rollback can no longer safely restore a committed file', async () => {
    await writeFile(join(root, 'existing.md'), 'Original');
    const before = await files.read('existing.md');
    const adapter = files as unknown as { replace(target: string, bytes: Uint8Array, mode?: number, verify?: () => Promise<void>): Promise<void> };
    const replace = adapter.replace.bind(files);
    vi.spyOn(adapter, 'replace').mockImplementation(async (target, ...args) => {
      if (target.endsWith('/failure.md')) {
        await writeFile(join(root, 'existing.md'), 'External edit');
        throw new Error('Injected write failure');
      }
      await replace(target, ...args);
    });
    await expect(files.writeBatch([{ ...write('existing.md', 'Changed'), expectedRevision: before.revision }, write('failure.md')], false)).rejects.toMatchObject({ code: 'ROLLBACK_FAILED' });
    expect(await readdir(root)).toEqual(['existing.md']);
    expect(await readFile(join(root, 'existing.md'), 'utf8')).toBe('External edit');
  });
  it('publishes only committed changes, and no event on validation/write failure or dry run', async () => {
    const events = new EventBus(new NodeEventScope());
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

it.each([false, true])('rejects malformed plugin byte plans without coercing data (dry run: %s)', async dryRun => {
  const workspace = new Workspace(files, new ObsidianDocuments(), new EventBus(new NodeEventScope()), dryRun);
  for (const bytes of ['hello', [256, -1, 1.5], { length: 3 }, null]) {
    const plan = [{ path: 'asset.bin', bytes }] as unknown as WriteRequest[];
    await expect(files.writeBatch(plan, dryRun)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    await expect(workspace.write(plan)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  }
  for (const malformed of [null, {}, [null], Array(1), [{ bytes: encodeText('Hello') }], [{ ...write('note.md'), expectedRevision: 42 }]]) {
    const plan = malformed as unknown as WriteRequest[];
    await expect(files.writeBatch(plan, dryRun)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
    await expect(workspace.write(plan)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  }
  expect(await readdir(root)).toEqual([]);
});
it('returns committed changes when recursive file notifications exceed the delivery limit', async () => {
  const events = new EventBus(new NodeEventScope());
  events.define({ id: 'file.created', validate: (v): v is object => typeof v === 'object' });
  const workspace = new Workspace(files, new ObsidianDocuments(), events, false);
  let count = 0;
  const failedWrites: unknown[] = [];
  events.on('file.created', async () => {
    try { await workspace.write([write(`derived-${++count}.md`)]); }
    catch (error) { failedWrites.push(error); }
  });
  const result = await workspace.write([write('original.md')]);
  expect(result.changes).toMatchObject([{ path: 'original.md', operation: 'created' }]);
  expect(await files.list()).toHaveLength(33);
  expect(failedWrites).toEqual([]);
  expect(events.warnings).toEqual([expect.stringContaining('recursion')]);
});
