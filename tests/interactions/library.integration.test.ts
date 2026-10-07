import { NodeEventScope } from '../../src/the-forge/infrastructure/plugins/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/the-forge/application/plugins/events.ts';
import { InteractionLibrary } from '../../src/the-forge/application/interactions/library.ts';
import { Workspace } from '../../src/the-forge/application/workspace/workspace.ts';
import { NodeFiles } from '../../src/the-forge/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/the-forge/infrastructure/documents/codec.ts';
import { MarkdownInteractionDefinitions } from '../../src/the-forge/infrastructure/interactions/definitions.ts';

let root: string, files: NodeFiles, events: EventBus;
const codec = new MarkdownInteractionDefinitions();
const library = (dryRun = false) => new InteractionLibrary(new Workspace(files, new ObsidianDocuments(), events, dryRun), codec);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-interactions-')); files = await NodeFiles.at(root); events = new EventBus(new NodeEventScope());
  for (const id of ['file.created', 'file.updated']) events.define({ id, validate: (value): value is unknown => value !== null });
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe('workspace interaction library lifecycle', () => {
  it('previews initialization, preserves authored definitions and emits events only after committed writes', async () => {
    const preview = await library(true).init('custom/interactions');
    expect(preview.changes).toHaveLength(5);
    expect(preview.preview?.map(file => file.content)).toEqual(expect.arrayContaining([expect.stringContaining('event: click'), expect.stringContaining('event: input')]));
    expect(await files.list()).toEqual([]); expect(events.history).toEqual([]);
    await library().create('custom/interactions/nested', 'toggle-expanded');
    const before = await files.read('custom/interactions/nested/toggle-expanded.md');
    await library().init('custom/interactions');
    expect(await files.read('custom/interactions/nested/toggle-expanded.md')).toEqual(before);
    expect((await library().init('custom/interactions')).changes).toEqual([]);
    expect((await library().list('custom/interactions')).map(item => item.id)).toEqual(['download', 'input-value', 'toggle-expanded', 'save', 'upload']);
    expect(events.history.map(event => event.id)).toEqual(Array(5).fill('file.created'));
    expect(await library().inspect('custom/interactions', 'toggle-expanded')).toMatchObject({ revision: before.revision, bytes: before.bytes.length, actions: [{ type: 'toggle-state', state: 'expanded' }] });
    expect(await library().validate('custom/interactions')).toMatchObject({ valid: true, count: 5, status: 'ready', interactions: ['download', 'input-value', 'toggle-expanded', 'save', 'upload'] });
  });
  it('preserves YAML comments, line endings, Markdown and nested paths exactly during transfers', async () => {
    const original = encodeText('---\r\n# retain this comment\r\nschemaVersion: 1\r\nid: activate\r\nevent: click\r\nactions:\r\n  - type: emit\r\n    event: panel:active\r\n---\r\n# Authored **prose**\r\n');
    await files.writeBatch([{ path: 'incoming/nested/activate.MD', bytes: original }], false);
    const spy = vi.spyOn(files, 'read');
    await library().import('incoming', 'assets/interactions');
    expect(spy.mock.calls.filter(([path]) => path === 'incoming/nested/activate.MD')).toHaveLength(1);
    await library().export('assets/interactions', 'outgoing');
    expect(new Uint8Array((await files.read('assets/interactions/nested/activate.MD')).bytes)).toEqual(original);
    expect(new Uint8Array((await files.read('outgoing/nested/activate.MD')).bytes)).toEqual(original);
  });
  it('rejects duplicate IDs, invalid source batches and destination collisions before writing', async () => {
    await library().create('incoming', 'activate');
    await library().create('library/nested', 'activate');
    const before = await files.list(), committed = events.history.length;
    await expect(library().import('incoming', 'library')).rejects.toMatchObject({ code: 'DUPLICATE_INTERACTION' });
    await expect(library().create('library', 'activate')).rejects.toMatchObject({ code: 'DUPLICATE_INTERACTION' });
    await expect(library().export('incoming', 'library')).rejects.toMatchObject({ code: 'DUPLICATE_INTERACTION' });
    expect(await files.list()).toEqual(before); expect(events.history).toHaveLength(committed);
    await files.writeBatch([{ path: 'incoming/invalid.md', bytes: encodeText('---\nid: invalid\n---\n') }], false);
    await expect(library().import('incoming', 'fresh')).rejects.toMatchObject({ code: 'INVALID_INTERACTION' });
    expect((await files.list()).some(path => path.startsWith('fresh/'))).toBe(false);
    await expect(library().import('empty', 'fresh')).rejects.toMatchObject({ code: 'EMPTY_INTERACTION_LIBRARY' });
    await expect(library().create('../outside', 'escape')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(library().inspect('library', 'missing')).rejects.toMatchObject({ code: 'UNKNOWN_INTERACTION' });
  });
  it('rejects overlapping transfer directories without corrupting recursively discovered source libraries', async () => {
    await library().create('library/nested', 'activate');
    const before = await files.read('library/nested/activate.md');
    const entries = await files.list(), history = [...events.history];
    for (const [source, destination] of [['library', 'library'], ['library', 'library/export'], ['library/nested', 'library']] as const) {
      await expect(library().import(source, destination)).rejects.toMatchObject({ code: 'INVALID_PATH' });
      await expect(library().export(source, destination)).rejects.toMatchObject({ code: 'INVALID_PATH' });
      await expect(library(true).export(source, destination)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    }
    expect(await files.list()).toEqual(entries);
    expect(events.history).toEqual(history);
    expect(await files.read('library/nested/activate.md')).toEqual(before);
    expect(await library().validate('library')).toMatchObject({ valid: true, count: 1 });
    await library().export('library', 'library-export');
    expect((await library().list('library-export')).map(definition => definition.id)).toEqual(['activate']);
  });
  it('validates empty libraries with guidance and creates event-appropriate input starters', async () => {
    expect(await library().validate('empty')).toMatchObject({ status: 'empty', valid: true, count: 0, nextStep: expect.stringContaining('interactions init --library empty') });
    await library().create('sources', 'read-input', 'change');
    expect(await library().inspect('sources', 'read-input')).toMatchObject({ event: 'change', actions: [{ type: 'set-state', state: 'value', fromEvent: 'value' }] });
    expect((await library(true).export('sources', 'preview')).preview?.[0]?.path).toBe('preview/read-input.md');
    expect((await files.list()).some(path => path.startsWith('preview/'))).toBe(false);
  });
  it('creates functional save, upload and download presets without invented endpoints', async () => {
    for (const id of ['save', 'upload', 'download']) await library().create('defaults', id);
    expect(await library().inspect('defaults', 'save')).toMatchObject({ event: 'submit', preventDefault: true, actions: [{ type: 'save-form', key: 'forge-form' }] });
    expect(await library().inspect('defaults', 'upload')).toMatchObject({ event: 'submit', preventDefault: true, actions: [{ type: 'upload-form', url: '{{uploadUrl}}' }] });
    expect(await library().inspect('defaults', 'download')).toMatchObject({ event: 'click', actions: [{ type: 'download-form', filename: 'form-data.json' }] });
    expect((await library().init('defaults')).skipped).toEqual(['download', 'save', 'upload']);
  });
});
