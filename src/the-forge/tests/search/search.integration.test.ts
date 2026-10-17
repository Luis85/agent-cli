import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { searchFiles, searchMatchingFiles, type SearchResult } from '../../src/plugins/search/application/search.ts';
import { renderWarning, type KernelMessage } from '../../src/domain/shared/kernel-messages.ts';
import { vmSearchBudget } from '../../src/plugins/search/infrastructure/budget.ts';
import type { SearchQuery } from '../../src/plugins/search/domain/query.ts';
import type { PageRequest } from '../../src/domain/shared/paging.ts';
import type { FileSnapshot } from '../../src/domain/documents/file.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { metadataIndex } from '../support/metadata.ts';

let root: string;
/** The files a search parsed for metadata filters: never the whole vault, only the candidates it read. */
const parsed: string[] = [];
/** The warnings of the last search, rendered in English. */
const warned: string[] = [];
const warn = (message: KernelMessage) => { warned.push(renderWarning(message)); };
const put = async (path: string, content: string | Uint8Array) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
};
const query = (pattern: string, extra: Partial<SearchQuery> = {}): SearchQuery => ({ pattern, regex: false, caseSensitive: false, scope: 'all', skipCode: false, context: 0, ...extra });
async function search(pattern: string, extra: Partial<SearchQuery> = {}, page: PageRequest = {}, timeoutMs = 10_000): Promise<SearchResult> {
  const files = await NodeFiles.at(root);
  const index = metadataIndex(files, { workspaceRoot: true });
  parsed.length = 0;
  warned.length = 0;
  const parse = (file: FileSnapshot) => { parsed.push(file.path); return index.parseFile(file); };
  const result = await searchFiles({ files, paths: () => index.vaultFiles(), parse, budget: vmSearchBudget(timeoutMs), warn }, query(pattern, extra), page);
  if (extra.tag === undefined && extra.property === undefined && !extra.skipCode) expect(parsed).toEqual([]);
  return result;
}
const places = (result: SearchResult) => result.hits.map(hit => `${hit.path}:${hit.line}:${hit.column}`);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-search-'));
  await put('notes/b.md', '---\nstatus: done\ntags: [project/alpha]\n---\n# Roadmap\nThe roadmap names the plan.\n```ts\nconst plan = 1;\n```\n');
  await put('notes/a.md', '---\nstatus: draft\n---\nPlan first, plan again.\n');
  await put('board.canvas', JSON.stringify({ nodes: [{ id: 'n', type: 'text', text: 'plan on canvas', x: 0, y: 0, width: 1, height: 1 }], edges: [] }));
  await put('src/plan.ts', 'export const plan = "PLAN";\n');
  await put('assets/plan.png', 'plan bytes are never searched');
  await put('.obsidian/plan.json', '{"plan":true}');
  // The workspace's own distribution is not vault content at the workspace root.
  await put('bin/data/docs/plan.md', 'plan in the distribution');
  await put('notes/binary.md', new Uint8Array([0x70, 0x6c, 0x61, 0x6e, 0xff, 0xfe]));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('searching vault text files', () => {
  it('returns hits of every text kind in path, line and column order with snippets and revisions', async () => {
    const result = await search('plan');
    expect(places(result)).toEqual(['board.canvas:1:43', 'notes/a.md:4:1', 'notes/a.md:4:13', 'notes/b.md:6:23', 'notes/b.md:8:7', 'src/plan.ts:1:14', 'src/plan.ts:1:22']);
    expect(result.total).toBe(7);
    expect(result.nextCursor).toBeUndefined();
    const [, first] = result.hits;
    expect(first).toEqual({ path: 'notes/a.md', line: 4, column: 1, match: 'Plan', snippet: 'Plan first, plan again.', revision: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it('skips text files with NUL characters, which read as attachments, but searches Markdown containing NUL', async () => {
    await put('nul.txt', new Uint8Array([0x61, 0x00, 0x62, 0x0a, ...new TextEncoder().encode('hello\n')]));
    await put('notes/nul-bytes.md', 'a\u0000b\nhello\n');
    await put('notes/clean.txt', 'hello\n');
    expect(places(await search('hello'))).toEqual(['notes/clean.txt:1:1', 'notes/nul-bytes.md:2:1']);
  });

  it('honours case sensitivity, regular expressions, kinds, paths and context lines', async () => {
    expect(places(await search('PLAN', { caseSensitive: true }))).toEqual(['src/plan.ts:1:22']);
    expect((await search('^#+ \\w+', { regex: true })).hits.map(hit => hit.match)).toEqual(['# Roadmap']);
    expect(places(await search('plan', { kind: 'text' }))).toEqual(['src/plan.ts:1:14', 'src/plan.ts:1:22']);
    expect(places(await search('plan', { path: 'notes/**' }))).toHaveLength(4);
    const [hit] = (await search('roadmap names', { context: 2 })).hits;
    expect(hit).toMatchObject({ path: 'notes/b.md', line: 6, before: ['---', '# Roadmap'], after: ['```ts', 'const plan = 1;'] });
  });

  it('treats a path without glob characters as that file or folder and warns when a path matches nothing', async () => {
    for (const path of ['notes', 'notes/', './notes']) expect(places(await search('plan', { path })), path).toEqual(places(await search('plan', { path: 'notes/**' })));
    expect(warned).toEqual([]);
    expect(places(await search('plan', { path: 'src/plan.ts' }))).toEqual(['src/plan.ts:1:14', 'src/plan.ts:1:22']);
    expect(places(await search('plan', { exclude: 'notes' }))).toEqual(['board.canvas:1:43', 'src/plan.ts:1:14', 'src/plan.ts:1:22']);
    // A folder of attachments matches, so no warning claims that the path does not exist.
    expect(await search('plan', { path: 'assets' })).toEqual({ hits: [], total: 0 });
    expect(warned).toEqual([]);
    expect(await search('plan', { path: 'Notes' })).toEqual({ hits: [], total: 0 });
    expect(warned).toEqual([expect.stringMatching(/^--path Notes matched no file in this scope\. .*run list/)]);
    expect(places(await search('plan', { path: 'note' }))).toEqual([]);
    expect(warned).toHaveLength(1);
  });

  it('lists the files with hits and their counts in path order, paged by file', async () => {
    const files = await NodeFiles.at(root);
    const index = metadataIndex(files, { workspaceRoot: true });
    const sources = { files, paths: () => index.vaultFiles(), parse: (file: FileSnapshot) => index.parseFile(file), budget: vmSearchBudget(10_000), warn };
    const all = await searchMatchingFiles(sources, query('plan'), {});
    expect(all).toEqual({
      files: ['board.canvas', 'notes/a.md', 'notes/b.md', 'src/plan.ts'].map((path, item) => ({ path, revision: expect.stringMatching(/^[0-9a-f]{64}$/), hits: [1, 2, 2, 2][item] })),
      total: 7, fileCount: 4,
    });
    const first = await searchMatchingFiles(sources, query('plan'), { limit: 3 });
    expect(first).toMatchObject({ files: all.files.slice(0, 3), total: 7, fileCount: 4, nextCursor: expect.any(String) });
    expect(await searchMatchingFiles(sources, query('plan'), { limit: 3, cursor: first.nextCursor })).toEqual({ files: all.files.slice(3), total: 7, fileCount: 4 });
    // A hit cursor never continues a page of files.
    const hits = await searchFiles(sources, query('plan'), { limit: 1 });
    await expect(searchMatchingFiles(sources, query('plan'), { cursor: hits.nextCursor })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect((await searchMatchingFiles(sources, query('plan', { property: { key: 'status', value: 'done' }, skipCode: true }), {})).files).toEqual([expect.objectContaining({ path: 'notes/b.md', hits: 1 })]);
  });

  it('excludes root-relative globs and brace alternatives without treating .gitignore as search policy', async () => {
    await put('src/dist/plan.ts', 'plan');
    await put('src/coverage/plan.ts', 'plan');
    await put('dist/plan.ts', 'plan');
    await put('.gitignore', '**/dist/\n**/coverage/\n');
    expect((await search('plan', { path: 'src/**' })).total).toBe(4);
    const result = await search('plan', { path: 'src/**', exclude: '**/{dist,coverage}/**' });
    expect(places(result)).toEqual(['src/plan.ts:1:14', 'src/plan.ts:1:22']);
    expect((await search('plan', { exclude: '**/{dist,coverage}/**' })).total).toBe(7);
    expect(await search('plan', { path: 'src/dist/**', exclude: '**/dist/**' })).toEqual({ hits: [], total: 0 });
    expect((await search('plan', { path: 'src/**', exclude: 'src/DIST/**' })).total).toBe(4);
  });

  it('never reads excluded files, including unreadable candidates, or parses their metadata', async () => {
    const files = await NodeFiles.at(root);
    const originalRead = files.read.bind(files);
    const read = vi.spyOn(files, 'read').mockImplementation(path => {
      if (path === 'notes/b.md') throw new Error('excluded file cannot be read');
      return originalRead(path);
    });
    const parse = vi.fn(async () => null);
    const result = await searchFiles({
      files, paths: async () => ['notes/a.md', 'notes/b.md'], parse, budget: vmSearchBudget(10_000), warn,
    }, query('plan', { exclude: 'notes/b.md', skipCode: true }), {});
    expect(places(result)).toEqual(['notes/a.md:4:1', 'notes/a.md:4:13']);
    expect(read.mock.calls).toEqual([['notes/a.md']]);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('binds cursors to the exact exclusion and resumes matching pages without duplicates', async () => {
    const filter = { exclude: '{board.canvas,src/**}' };
    const first = await search('plan', filter, { limit: 2 });
    expect(first).toMatchObject({ total: 4, nextCursor: expect.any(String) });
    const last = await search('plan', filter, { limit: 2, cursor: first.nextCursor });
    expect([...places(first), ...places(last)]).toEqual(places(await search('plan', filter)));
    expect(last.nextCursor).toBeUndefined();
    for (const extra of [{}, { exclude: 'src/**' }]) {
      await expect(search('plan', extra, { cursor: first.nextCursor })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    const unfiltered = await search('plan', {}, { limit: 1 });
    await expect(search('plan', filter, { cursor: unfiltered.nextCursor })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects malformed exclusions before enumerating or reading files', async () => {
    const files = await NodeFiles.at(root);
    const read = vi.spyOn(files, 'read');
    const paths = vi.fn(async () => []);
    const sources = { files, paths, parse: async () => null, budget: vmSearchBudget(10_000), warn };
    for (const exclude of ['', '**/[z-a]', '**/{dist,coverage', 'x'.repeat(1025)]) {
      await expect(searchFiles(sources, query('plan', { exclude }), {})).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT', message: expect.stringContaining('--exclude'),
      });
    }
    expect(paths).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('reads the Markdown body or frontmatter only, and skips code blocks through the metadata cache', async () => {
    expect(places(await search('status', { scope: 'frontmatter' }))).toEqual(['notes/a.md:2:1', 'notes/b.md:2:1']);
    expect(places(await search('status', { scope: 'body' }))).toEqual([]);
    expect(places(await search('plan', { scope: 'body', skipCode: true, kind: 'markdown' }))).toEqual(['notes/a.md:4:1', 'notes/a.md:4:13', 'notes/b.md:6:23']);
  });

  it('filters notes by tag and property through the metadata cache', async () => {
    expect(places(await search('plan', { tag: 'project' }))).toEqual(['notes/b.md:6:23', 'notes/b.md:8:7']);
    expect(places(await search('plan', { property: { key: 'status', value: 'draft' } }))).toEqual(['notes/a.md:4:1', 'notes/a.md:4:13']);
    expect(places(await search('plan', { property: { key: 'owner' } }))).toEqual([]);
  });

  it('pages with cursors that resume after the last hit and are bound to the query', async () => {
    const first = await search('plan', {}, { limit: 3 });
    expect(places(first)).toEqual(['board.canvas:1:43', 'notes/a.md:4:1', 'notes/a.md:4:13']);
    expect(first).toMatchObject({ total: 7, nextCursor: expect.any(String) });
    const second = await search('plan', {}, { limit: 3, cursor: first.nextCursor });
    expect(places(second)).toEqual(['notes/b.md:6:23', 'notes/b.md:8:7', 'src/plan.ts:1:14']);
    const last = await search('plan', { context: 1 }, { limit: 3, cursor: second.nextCursor });
    expect(places(last)).toEqual(['src/plan.ts:1:22']);
    expect(last.nextCursor).toBeUndefined();
    await expect(search('plans', {}, { limit: 3, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('fails a catastrophically backtracking expression with SEARCH_TIMEOUT instead of hanging', async () => {
    await put('notes/slow.md', `${'a'.repeat(40)}!\n`);
    const started = performance.now();
    await expect(search('^(a+)+$', { regex: true }, {}, 200)).rejects.toMatchObject({ code: 'SEARCH_TIMEOUT', details: { timeoutMs: 200 } });
    expect(performance.now() - started).toBeLessThan(10_000);
    await expect(search('(', { regex: true })).rejects.toMatchObject({ code: 'INVALID_SEARCH_PATTERN' });
  });

  it('filters paths with an adversarial glob in polynomial time', async () => {
    await put(`g/${'a'.repeat(200)}.md`, 'plan\n');
    const started = performance.now();
    expect((await search('plan', { path: `g/${'*a'.repeat(40)}*c` })).total).toBe(0);
    expect((await search('plan', { path: `g/${'*a'.repeat(40)}*` })).total).toBe(1);
    expect(performance.now() - started).toBeLessThan(2000);
    await expect(search('plan', { path: 'notes/[z-a]' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('parses only the files it reads for metadata filters, narrowed by --path', async () => {
    expect(places(await search('plan', { tag: 'project', path: 'notes/b.md' }))).toEqual(['notes/b.md:6:23', 'notes/b.md:8:7']);
    expect(parsed).toEqual(['notes/b.md']);
  });

  it('searches 3,000 notes by tag within a budget, parsing only files with hits and building snippets only for the returned page', async () => {
    // Write the fixture in parallel batches: 3,000 sequential writes alone took most of this test on Windows runners.
    const folders = Array.from({ length: 30 }, (_, index) => `scale/${String(index).padStart(2, '0')}`);
    await Promise.all(folders.map(folder => mkdir(join(root, folder), { recursive: true })));
    for (let start = 0; start < 3000; start += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, offset) => {
        const index = start + offset;
        const body = index % 10 === 0 ? 'Release checklist line. '.repeat(20) : 'Ordinary prose. '.repeat(20);
        return writeFile(join(root, folders[index % 30]!, `note-${String(index).padStart(4, '0')}.md`), `---\ntags: [${index % 3 === 0 ? 'release' : 'draft'}]\n---\n# Note ${index}\n${body}\n`);
      }));
    }
    // The measured search starts cold: a new repository and metadata index that has read nothing.
    const started = performance.now();
    const result = await search('checklist', { tag: 'release', context: 1 }, { limit: 5 });
    expect(performance.now() - started).toBeLessThan(10_000);
    // Every 30th note is a release note with the checklist: 100 notes of 20 hits each.
    expect(result.total).toBe(2000);
    expect(result.hits).toHaveLength(5);
    expect(result.hits[0]).toMatchObject({ path: 'scale/00/note-0000.md', line: 5, before: ['# Note 0'], after: [''], snippet: expect.stringContaining('…') });
    expect(parsed).toHaveLength(300);
    expect((await search('checklist', { property: { key: 'tags', value: 'release' } }, { limit: 1 })).total).toBe(2000);
  }, 60_000);
});

