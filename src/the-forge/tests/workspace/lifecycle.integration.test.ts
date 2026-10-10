import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents, type HostEventMap } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { AppError } from '../../src/domain/shared/errors.ts';

let root: string, files: NodeFiles, events: EventBus, workspace: Workspace;
const write = (path = 'note.md', text = 'Private contents') => ({ path, bytes: encodeText(text) });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-workspace-events-'));
  files = await NodeFiles.at(root);
  events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  workspace = new Workspace(files, new ObsidianDocuments(), events, false, root);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe('workspace lifecycle notifications', () => {
  it('correlates operations with committed changes and emits content-free read metadata', async () => {
    const result = await workspace.write([write()]);
    const read = await workspace.read('note.md');
    await workspace.remove('note.md', read.revision);
    expect(events.history.map(record => record.id)).toEqual([
      'operation.started', 'vault.create', 'operation.succeeded',
      'operation.started', 'workspace.file-open', 'operation.succeeded',
      'operation.started', 'vault.delete', 'operation.succeeded',
    ]);
    expect(events.history[0]!.payload).toEqual({ operationId: 1, operation: 'write', root, paths: ['note.md'], dryRun: false });
    expect(events.history[1]!.payload).toEqual({ ...result.changes[0], kind: 'file' });
    expect(events.history[2]!.payload).toMatchObject({ operationId: 1, changes: result.changes, bytes: read.bytes });
    expect(events.history[4]!.payload).toEqual({ path: 'note.md' });
    expect(events.history[5]!.payload).toEqual({ operationId: 2, operation: 'read', root, paths: ['note.md'], dryRun: false, bytes: read.bytes });
    expect(events.history[7]!.payload).toEqual({ path: 'note.md', kind: 'file', operation: 'deleted', revision: read.revision, bytes: read.bytes });
    expect(events.history[8]!.payload).toMatchObject({ operationId: 3, operation: 'remove', changes: [{ operation: 'deleted' }] });
    expect(JSON.stringify(events.history)).not.toContain('Private contents');
  });

  it('reports dry-run changes as quick previews without committing files or vault events', async () => {
    await workspace.write([write('existing.md', 'Before')]);
    events.history.length = 0;
    const preview = new Workspace(files, new ObsidianDocuments(), events, true, root);
    const before = await files.read('existing.md');
    const result = await preview.write([write('nested/note.md'), { ...write('existing.md', 'After!'), expectedRevision: before.revision }]);
    expect(await readdir(root)).toEqual(['existing.md']);
    expect(events.history.map(record => record.id)).toEqual(['operation.started', 'workspace.quick-preview', 'workspace.quick-preview', 'operation.succeeded']);
    expect(events.history.slice(1, 3).map(record => record.payload)).toEqual([
      { path: 'nested/note.md', operation: 'created', bytes: 16 }, { path: 'existing.md', operation: 'updated', bytes: 6 },
    ]);
    expect(events.history[3]!.payload).toMatchObject({ dryRun: true, changes: result.changes });
  });

  it('emits created folders parent before child, then file records in batch order', async () => {
    await workspace.write([write('a/existing.md')]);
    events.history.length = 0;
    await workspace.write([write('z.md'), write('a/b/c/deep.md'), write('a/b/sibling.md'), write('d/e.md')]);
    expect(events.history.filter(record => record.id.startsWith('vault.')).map(record => {
      const { path, kind } = record.payload as { path: string; kind: string };
      return `${record.id} ${kind} ${path}`;
    })).toEqual([
      'vault.create folder a/b', 'vault.create folder a/b/c', 'vault.create folder d',
      'vault.create file z.md', 'vault.create file a/b/c/deep.md', 'vault.create file a/b/sibling.md', 'vault.create file d/e.md',
    ]);
    expect(events.history.find(record => (record.payload as { kind?: string }).kind === 'folder')!.payload).toEqual({ path: 'a/b', kind: 'folder', operation: 'created' });
  });

  it('awaits listeners while preserving the original write snapshot', async () => {
    const request = write();
    const order: string[] = [];
    events.on('operation.started', async () => {
      await Promise.resolve();
      request.path = 'changed.md'; request.bytes.fill(0);
      order.push('started');
    });
    events.on('operation.succeeded', async () => { await Promise.resolve(); order.push('succeeded'); });
    await workspace.write([request]);
    order.push('returned');
    expect(order).toEqual(['started', 'succeeded', 'returned']);
    expect(await files.list()).toEqual(['note.md']);
    expect(new TextDecoder().decode((await files.read('note.md')).bytes)).toBe('Private contents');
  });

  it('reports snapshot and document-validation failures without writes', async () => {
    await expect(workspace.write([write('../outside.md')])).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(workspace.write([write('invalid.canvas', '{')])).rejects.toBeInstanceOf(AppError);
    expect(events.history.map(record => record.id)).toEqual(['operation.started', 'operation.failed', 'operation.started', 'operation.failed']);
    expect(events.history[1]!.payload).toMatchObject({ operationId: 1, paths: [], error: { code: 'INVALID_PATH', exitCode: 2 } });
    expect(events.history[3]!.payload).toMatchObject({ operationId: 2, paths: ['invalid.canvas'] });
    expect(await files.list()).toEqual([]);
  });

  it('preserves original failures despite failed listeners and redacts diagnostics', async () => {
    const primary = new AppError('PRIVATE_FAILURE', 'Secret contents', 7, { token: 'private-token' });
    vi.spyOn(files, 'read').mockRejectedValue(primary);
    events.on('operation.started', () => { throw new Error('Started listener failed'); });
    events.on('operation.failed', () => { throw new Error('Failed listener failed'); });
    await expect(workspace.read('note.md')).rejects.toBe(primary);
    expect(events.history[1]!.payload).toMatchObject({ error: { code: 'PRIVATE_FAILURE', exitCode: 7 } });
    expect(JSON.stringify(events.history)).not.toMatch(/Secret contents|private-token/);
    expect(events.warnings).toHaveLength(2);
  });

  it.each(['read', 'remove'] as const)('observes invalid empty paths for %s without losing the failure', async operation => {
    const result = operation === 'read' ? workspace.read('') : workspace.remove('', 'revision');
    await expect(result).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(events.history.map(record => record.id)).toEqual(['operation.started', 'operation.failed']);
    expect(events.history[1]!.payload).toMatchObject({ operation, paths: [], error: { code: 'INVALID_PATH', exitCode: 2 } });
    expect(events.warnings).toEqual([]);
  });

  it('pairs nested edit and write operations with separate identifiers', async () => {
    await files.writeBatch([write()], false);
    const file = await files.read('note.md');
    await workspace.edit('note.md', file.revision, () => encodeText('Updated'));
    expect(events.history.map(record => record.id)).toEqual(['operation.started', 'operation.started', 'vault.modify', 'operation.succeeded', 'operation.succeeded']);
    expect(events.history[0]!.payload).toMatchObject({ operationId: 1, operation: 'edit' });
    expect(events.history[1]!.payload).toMatchObject({ operationId: 2, operation: 'write' });
    expect(events.history[3]!.payload).toMatchObject({ operationId: 2, operation: 'write' });
    expect(events.history[4]!.payload).toMatchObject({ operationId: 1, operation: 'edit' });
    await expect(workspace.edit('note.md', file.revision, () => encodeText('Stale'))).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(events.history.slice(-2).map(record => record.id)).toEqual(['operation.started', 'operation.failed']);
  });

  it('reports transform failures without exposing arbitrary error messages', async () => {
    await files.writeBatch([write()], false);
    const file = await files.read('note.md');
    const primary = new Error('Private transform input');
    await expect(workspace.edit('note.md', file.revision, () => { throw primary; })).rejects.toBe(primary);
    expect(events.history[1]!.payload).toMatchObject({ operation: 'edit', error: { code: 'OPERATION_FAILED', exitCode: 1 } });
    expect((await files.read('note.md')).revision).toBe(file.revision);
  });

  it('retains legacy history for isolated buses without host registration', async () => {
    const isolated = new EventBus(new NodeEventScope());
    isolated.define({ id: 'vault.create', validate: (value): value is HostEventMap['vault.create'] => typeof value === 'object' });
    await new Workspace(files, new ObsidianDocuments(), isolated, false).write([write()]);
    expect(isolated.history.map(record => record.id)).toEqual(['vault.create']);
    expect(isolated.warnings).toEqual([]);
  });

  it.each([false, true])('preserves committed results after unprintable notification failures (broken diagnostic sink: %s)', async brokenSink => {
    const emit = events.emit.bind(events);
    const notified: string[] = [];
    vi.spyOn(events, 'emit').mockImplementation(async (id, payload) => {
      if (id === 'vault.create') {
        notified.push((payload as { path: string }).path);
        throw Object.create(null);
      }
      return emit(id, payload);
    });
    if (brokenSink) vi.spyOn(events, 'warn').mockImplementation(() => { throw new Error('Diagnostic sink unavailable'); });
    const result = await workspace.write([write('one.md', 'One'), write('two.md', 'Two')]);
    expect(result).toMatchObject({ dryRun: false, changes: [{ path: 'one.md', operation: 'created' }, { path: 'two.md', operation: 'created' }] });
    expect(new TextDecoder().decode((await files.read('one.md')).bytes)).toBe('One');
    expect(new TextDecoder().decode((await files.read('two.md')).bytes)).toBe('Two');
    expect(notified).toEqual(['one.md', 'two.md']);
    expect(events.history.map(record => record.id)).toEqual(['operation.started', 'operation.succeeded']);
    if (!brokenSink) expect(events.warnings).toEqual([
      'Committed one.md; vault notification failed: Operation failed with an unreadable error.',
      'Committed two.md; vault notification failed: Operation failed with an unreadable error.',
    ]);
  });
});
