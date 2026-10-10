import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { searchFiles, type SearchResult } from '../../src/plugins/search/application/search.ts';
import { vmSearchBudget } from '../../src/plugins/search/infrastructure/budget.ts';
import type { SearchQuery } from '../../src/plugins/search/domain/query.ts';
import type { PageRequest } from '../../src/domain/shared/paging.ts';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { metadataIndex } from '../support/metadata.ts';

let root: string;
const put = async (path: string, content: string | Uint8Array) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
};
const query = (pattern: string, extra: Partial<SearchQuery> = {}): SearchQuery => ({ pattern, regex: false, caseSensitive: false, scope: 'all', skipCode: false, context: 0, ...extra });
async function search(pattern: string, extra: Partial<SearchQuery> = {}, page: PageRequest = {}, timeoutMs = 10_000): Promise<SearchResult> {
  const files = await NodeFiles.at(root);
  let loads = 0;
  const result = await searchFiles({ files, metadata: () => { loads++; return metadataIndex(files).load(); }, budget: vmSearchBudget(timeoutMs) }, query(pattern, extra), page);
  if (extra.tag === undefined && extra.property === undefined && !extra.skipCode) expect(loads).toBe(0);
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

  it('honours case sensitivity, regular expressions, kinds, paths and context lines', async () => {
    expect(places(await search('PLAN', { caseSensitive: true }))).toEqual(['src/plan.ts:1:22']);
    expect((await search('^#+ \\w+', { regex: true })).hits.map(hit => hit.match)).toEqual(['# Roadmap']);
    expect(places(await search('plan', { kind: 'text' }))).toEqual(['src/plan.ts:1:14', 'src/plan.ts:1:22']);
    expect(places(await search('plan', { path: 'notes/**' }))).toHaveLength(4);
    const [hit] = (await search('roadmap names', { context: 2 })).hits;
    expect(hit).toMatchObject({ path: 'notes/b.md', line: 6, before: ['---', '# Roadmap'], after: ['```ts', 'const plan = 1;'] });
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
});
