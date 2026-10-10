import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { EventBus } from '../../src/application/plugins/events.ts';
import { UiLibrary, type UiRenderer } from '../../src/application/ui/library.ts';
import { Workspace } from '../../src/application/workspace/workspace.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';
import { MarkdownUiDefinitions } from '../../src/infrastructure/ui/definitions.ts';
import { standardUiCatalog } from '../../src/infrastructure/ui/catalog.ts';

let root: string, files: NodeFiles;
const codec = new MarkdownUiDefinitions();
const source = (id: string, fields: Record<string, unknown> = {}, body = '# Description\n\nKeep **Markdown** and {{prose}} intact.\n') => encodeText(`---\n${stringify({ schemaVersion: 1, id, root: { tag: 'div', children: [{ slot: 'children' }] }, ...fields })}---\n${body}`);
const library = (dryRun = false, renderer?: UiRenderer) => new UiLibrary(new Workspace(files, new ObsidianDocuments(), new EventBus(new NodeEventScope()), dryRun), codec, standardUiCatalog, renderer);
const put = async (path: string, id: string, fields: Record<string, unknown> = {}) => files.writeBatch([{ path, bytes: source(id, fields) }], false);
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-ui-')); files = await NodeFiles.at(root); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe('workspace UI library lifecycle', () => {
  it('discovers recursively in deterministic path order and inspects definitions', async () => {
    await put('custom/ui/z.md', 'zeta'); await put('custom/ui/a/first.md', 'alpha');
    await put('unrelated/other.md', 'other');
    expect((await library().list('custom/ui')).map(item => item.id)).toEqual(['alpha', 'zeta']);
    expect(await library().inspect('custom/ui', 'alpha')).toMatchObject({ id: 'alpha', sourcePath: 'custom/ui/a/first.md' });
    await expect(library().inspect('custom/ui', 'missing')).rejects.toMatchObject({ code: 'UNKNOWN_UI_COMPONENT' });
  });
  it('previews catalog initialization and preserves existing definitions on repeated init', async () => {
    const preview = await library(true).init('ui');
    expect(preview.changes).toHaveLength(standardUiCatalog.length);
    expect(preview.preview?.[0]?.content).toContain('schemaVersion: 1');
    expect(await files.list()).toEqual([]);
    await put('ui/custom/button.md', 'button', { root: { tag: 'button', text: 'Custom' } });
    const before = await files.read('ui/custom/button.md');
    await library().init('ui');
    expect(await files.read('ui/custom/button.md')).toEqual(before);
    expect((await library().init('ui')).changes).toEqual([]);
  });
  it('copies exact validated Markdown bytes preserving nested import/export paths', async () => {
    await put('imports/nested/child.md', 'child');
    await put('imports/parent.md', 'parent', { root: { component: 'child' } });
    const spy = vi.spyOn(files, 'read');
    await library().import('imports', 'custom/library');
    expect(spy.mock.calls.filter(([path]) => path === 'imports/nested/child.md')).toHaveLength(1);
    expect((await files.read('custom/library/nested/child.md')).bytes).toEqual((await files.read('imports/nested/child.md')).bytes);
    await library().export('custom/library', 'exports/ui');
    expect((await files.read('exports/ui/parent.md')).bytes).toEqual((await files.read('imports/parent.md')).bytes);
  });
  it('preflights full graph, duplicate ids and all file collisions without partial writes', async () => {
    await put('imports/a.md', 'good'); await put('imports/b.md', 'bad', { root: { component: 'absent' } });
    await expect(library().import('imports', 'library')).rejects.toMatchObject({ code: 'UNKNOWN_UI_COMPONENT' });
    expect((await files.list()).filter(path => path.startsWith('library/'))).toEqual([]);
    await put('other/good.md', 'good');
    await expect(library().import('other', 'imports')).rejects.toMatchObject({ code: 'DUPLICATE_UI_COMPONENT' });
    await put('collision/good.md', 'different');
    await expect(library().import('other', 'collision')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await library().list('collision')).map(item => item.id)).toEqual(['different']);
  });
  it('imports references against existing destination definitions and validates export destinations', async () => {
    await put('library/child.md', 'child');
    await put('incoming/parent.md', 'parent', { root: { component: 'child' } });
    await library().import('incoming', 'library');
    await put('exports/existing.md', 'parent');
    await expect(library().export('library', 'exports')).rejects.toMatchObject({ code: 'DUPLICATE_UI_COMPONENT' });
    expect((await files.list()).filter(path => path.startsWith('exports/'))).toEqual(['exports/existing.md']);
  });
  it('selects transitive dependencies and validates only their native Storybook modules', async () => {
    await put('library/child.md', 'child');
    await put('library/parent.md', 'parent', { root: { component: 'child' } });
    await put('library/unrelated.md', 'unrelated', { storybook: { extension: 'missing.mjs' } });
    const generate = vi.fn<UiRenderer['generate']>(() => [{ path: 'project/ui/parent.ts', bytes: encodeText('export {};\n') }]);
    const result = await library(true, { generate }).generate('library', { component: 'parent', framework: 'react', outputDirectory: 'project/ui', storybook: true, storiesDirectory: 'project/stories' });
    expect(generate.mock.calls[0]?.[0].map(item => item.id)).toEqual(['child', 'parent']);
    expect(result.preview?.[0]?.path).toBe('project/ui/parent.ts');
    expect((await files.list()).filter(path => path.startsWith('project/'))).toEqual([]);
    await expect(library(false, { generate }).generate('library', { framework: 'react', outputDirectory: 'project/ui', storybook: true, storiesDirectory: 'project/stories' })).rejects.toMatchObject({ code: 'INVALID_UI' });
  });
  it('requires existing generated components before writing standalone stories', async () => {
    await put('library/child.md', 'child');
    const generate = vi.fn<UiRenderer['generate']>(() => [{ path: 'stories/Child.stories.ts', bytes: encodeText('export {};\n') }]);
    const renderer = { generate, componentPaths: () => ['ui/Child.tsx'] };
    const options = { framework: 'react' as const, outputDirectory: 'ui', storiesDirectory: 'stories', storiesOnly: true };
    await expect(library(false, renderer).generate('library', options)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(generate).not.toHaveBeenCalled();
    await files.writeBatch([{ path: 'ui/Child.tsx', bytes: encodeText('export {};') }], false);
    await library(false, renderer).generate('library', options);
    expect((await files.list())).toContain('stories/Child.stories.ts');
  });
  it('creates custom definitions with collisions guarded and rejects escaping destinations', async () => {
    await library().create('custom/library', 'hero', 'section');
    expect(await library().inspect('custom/library', 'hero')).toMatchObject({ root: { tag: 'section' } });
    await library().create('custom/library', 'portrait', 'img');
    expect(await library().inspect('custom/library', 'portrait')).toMatchObject({ root: { tag: 'img' } });
    await expect(library().create('custom/library', 'hero')).rejects.toMatchObject({ code: 'DUPLICATE_UI_COMPONENT' });
    await expect(library().export('custom/library', '../outside')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(library().init('/absolute')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
  it('regenerates only with current revisions and rejects revision paths outside the plan', async () => {
    await put('library/child.md', 'child');
    let content = 'export const label = "first";\n';
    const renderer: UiRenderer = { generate: () => [{ path: 'project/ui/Child.ts', bytes: encodeText(content) }] };
    const options = { framework: 'vanilla' as const, outputDirectory: 'project/ui' };
    await library(false, renderer).generate('library', options);
    const before = await files.read('project/ui/Child.ts');
    content = 'export const label = "changed";\n';
    await expect(library(false, renderer).generate('library', options)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(library(false, renderer).generate('library', { ...options, revisions: { 'unrelated.ts': before.revision } })).rejects.toMatchObject({ code: 'INVALID_GENERATION_REVISIONS' });
    await expect(library(false, renderer).generate('library', { ...options, revisions: { 'project/ui/Child.ts': 'wrong' } })).rejects.toMatchObject({ code: 'INVALID_GENERATION_REVISIONS' });
    await library(false, renderer).generate('library', { ...options, revisions: { 'project/ui/Child.ts': before.revision } });
    expect(new TextDecoder().decode((await files.read('project/ui/Child.ts')).bytes)).toBe(content);
    await expect(library(false, renderer).generate('library', { ...options, revisions: { 'project/ui/Child.ts': before.revision } })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

it('inspects the exact source revision and explains an empty library', async () => {
  expect(await library().validate('empty')).toMatchObject({ valid: true, status: 'empty', count: 0, nextStep: expect.stringContaining('components init') });
  await put('library/hero.md', 'hero');
  const snapshot = await files.read('library/hero.md');
  expect(await library().inspect('library', 'hero')).toMatchObject({ revision: snapshot.revision, bytes: snapshot.bytes.length });
});
