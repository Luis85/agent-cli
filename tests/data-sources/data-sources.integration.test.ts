import { NodeEventScope } from '../../src/the-forge/infrastructure/plugins/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../src/the-forge/application/plugins/events.ts';
import { DataSourceLibrary, type DataSourceRenderer } from '../../src/the-forge/application/data-sources/library.ts';
import { Workspace } from '../../src/the-forge/application/workspace/workspace.ts';
import { NodeFiles } from '../../src/the-forge/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/the-forge/infrastructure/documents/codec.ts';
import { MarkdownDataSourceDefinitions } from '../../src/the-forge/infrastructure/data-sources/definitions.ts';

let root: string, files: NodeFiles;
const codec = new MarkdownDataSourceDefinitions();
const library = (dryRun = false, renderer?: DataSourceRenderer) => new DataSourceLibrary(new Workspace(files, new ObsidianDocuments(), new EventBus(new NodeEventScope()), dryRun), codec, renderer);
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-data-sources-')); files = await NodeFiles.at(root); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe('workspace data-source library lifecycle', () => {
  it('previews initialization, preserves existing definitions and discovers nested files in order', async () => {
    const preview = await library(true).init('custom/sources');
    expect(preview.changes).toHaveLength(2);
    expect(preview.preview?.map(file => file.content)).toEqual(expect.arrayContaining([expect.stringContaining('kind: rest'), expect.stringContaining('kind: json')]));
    expect(await files.list()).toEqual([]);
    await library().create('custom/sources/nested', 'example-rest', 'rest');
    const before = await files.read('custom/sources/nested/example-rest.md');
    await library().init('custom/sources');
    expect(await files.read('custom/sources/nested/example-rest.md')).toEqual(before);
    expect((await library().init('custom/sources')).changes).toEqual([]);
    expect((await library().list('custom/sources')).map(item => item.id)).toEqual(['example-json', 'example-rest']);
    expect(await library().inspect('custom/sources', 'example-json')).toMatchObject({ kind: 'json', json: { path: 'data/items.json' } });
    expect(await library().validate('custom/sources')).toEqual({ valid: true, sources: ['example-json', 'example-rest'] });
    await expect(library().inspect('custom/sources', 'missing')).rejects.toMatchObject({ code: 'UNKNOWN_DATA_SOURCE' });
  });
  it('preserves exact Markdown bytes and nested paths during import/export', async () => {
    await library().create('incoming/nested', 'products');
    await library().create('incoming', 'inventory', 'json');
    const spy = vi.spyOn(files, 'read');
    await library().import('incoming', 'custom/library');
    expect(spy.mock.calls.filter(([path]) => path === 'incoming/nested/products.md')).toHaveLength(1);
    expect((await files.read('custom/library/nested/products.md')).bytes).toEqual((await files.read('incoming/nested/products.md')).bytes);
    await library().export('custom/library', 'outgoing');
    expect((await files.read('outgoing/nested/products.md')).bytes).toEqual((await files.read('incoming/nested/products.md')).bytes);
  });
  it('rejects overlapping transfer directories without corrupting recursively discovered definitions', async () => {
    await library().create('sources', 'products');
    const before = await files.list();
    for (const output of ['sources', 'sources/nested']) {
      await expect(library().export('sources', output)).rejects.toMatchObject({ code: 'INVALID_PATH' });
      await expect(library().import('sources', output)).rejects.toMatchObject({ code: 'INVALID_PATH' });
    }
    expect(await files.list()).toEqual(before);
    expect((await library().list('sources')).map(source => source.id)).toEqual(['products']);
  });
  it('rejects duplicates, malformed definitions and collisions before any destination writes', async () => {
    await library().create('incoming', 'products');
    await library().create('library/nested', 'products');
    await expect(library().import('incoming', 'library')).rejects.toMatchObject({ code: 'DUPLICATE_DATA_SOURCE' });
    await expect(library().create('library', 'products')).rejects.toMatchObject({ code: 'DUPLICATE_DATA_SOURCE' });
    await expect(library().export('incoming', 'library')).rejects.toMatchObject({ code: 'DUPLICATE_DATA_SOURCE' });
    await files.writeBatch([{ path: 'incoming/invalid.md', bytes: encodeText('---\nid: invalid\n---\n') }], false);
    await expect(library().import('incoming', 'fresh')).rejects.toMatchObject({ code: 'INVALID_DATA_SOURCE' });
    expect((await files.list()).some(path => path.startsWith('fresh/'))).toBe(false);
    await expect(library().import('empty', 'fresh')).rejects.toMatchObject({ code: 'EMPTY_DATA_SOURCE_LIBRARY' });
    await expect(library().create('../outside', 'escape')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
  it('plans selected sources with independently configured adapter/fixture paths and dry-run previews', async () => {
    await library().create('sources', 'products'); await library().create('sources', 'inventory', 'json');
    const generate = vi.fn<DataSourceRenderer['generate']>((definitions, options) => [
      { path: `${options.outputDirectory}/${definitions[0]!.id}.ts`, bytes: encodeText('export {};\n') },
      { path: `${options.testDataDirectory}/${definitions[0]!.id}.json`, bytes: encodeText('[{"id":"1"}]\n') },
    ]);
    const result = await library(true, { generate }).generate('sources', { source: 'products', outputDirectory: 'projects/shop/src/data', testDataDirectory: 'projects/shop/fixtures' });
    expect(generate.mock.calls[0]?.[0].map(item => item.id)).toEqual(['products']);
    expect(result.preview?.map(file => file.path)).toEqual(['projects/shop/src/data/products.ts', 'projects/shop/fixtures/products.json']);
    expect((await files.list()).some(path => path.startsWith('projects/'))).toBe(false);
    await expect(library(false, { generate }).generate('sources', { source: 'missing', outputDirectory: 'output', testDataDirectory: 'fixtures' })).rejects.toMatchObject({ code: 'UNKNOWN_DATA_SOURCE' });
    await expect(library(false, { generate }).generate('empty', { outputDirectory: 'output', testDataDirectory: 'fixtures' })).rejects.toMatchObject({ code: 'EMPTY_DATA_SOURCE_LIBRARY' });
  });
  it('guards multi-file regeneration with inspected revisions and rolls back stale plans', async () => {
    await library().create('sources', 'products');
    let content = 'export const version = 1;\n';
    const renderer: DataSourceRenderer = { generate: () => [{ path: 'src/products.ts', bytes: encodeText(content) }, { path: 'fixtures/products.json', bytes: encodeText('[]\n') }] };
    const options = { outputDirectory: 'src', testDataDirectory: 'fixtures' };
    expect((await library(false, renderer).plan('sources', options)).outputs.every(output => output.status === 'missing')).toBe(true);
    await expect(library(false, renderer).check('sources', options)).rejects.toMatchObject({ code: 'DATA_SOURCE_DRIFT' });
    await library(false, renderer).generate('sources', options);
    expect((await library(false, renderer).check('sources', options)).matches).toBe(true);
    const adapter = await files.read('src/products.ts'), fixture = await files.read('fixtures/products.json');
    content = 'export const version = 2;\n';
    const planned = await library(false, renderer).plan('sources', options, 'review/revisions.json');
    expect(planned.outputs.map(output => output.status)).toEqual(['changed', 'unchanged']);
    expect(JSON.parse(new TextDecoder().decode((await files.read('review/revisions.json')).bytes))).toEqual(planned.revisions);
    await expect(library(false, renderer).generate('sources', options)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(library(false, renderer).generate('sources', { ...options, revisions: { 'other.ts': adapter.revision } })).rejects.toMatchObject({ code: 'INVALID_GENERATION_REVISIONS' });
    await expect(library(false, renderer).generate('sources', { ...options, revisions: { 'src/products.ts': 'bad' } })).rejects.toMatchObject({ code: 'INVALID_GENERATION_REVISIONS' });
    const revisions = { 'src/products.ts': adapter.revision, 'fixtures/products.json': fixture.revision };
    await library(false, renderer).generate('sources', { ...options, revisions });
    expect(new TextDecoder().decode((await files.read('src/products.ts')).bytes)).toBe(content);
    await expect(library(false, renderer).generate('sources', { ...options, revisions })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await files.read('fixtures/products.json')).toEqual(fixture);
  });
});
