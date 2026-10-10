import { describe, expect, it } from 'vitest';
import { pathGlob } from '../../src/domain/documents/path-glob.ts';
import { compareKeys, Pager } from '../../src/domain/shared/paging.ts';
import type { CommandContext } from '../../src/application/plugins/registry.ts';
import { documentCommands } from '../../src/presentation/documents/commands.ts';
import { MemoryFiles } from '../support/metadata.ts';

const paths = ['README.md', 'notes/a.md', 'notes/deep/b.md', 'notes/deep/c.canvas', 'src/x.ts', 'src/y.test.ts', 'Ünïcode/ä.md'];
const matching = (pattern: string) => paths.filter(pathGlob(pattern));

describe('path globs', () => {
  it.each([
    ['*.md', ['README.md']],
    ['notes/*.md', ['notes/a.md']],
    ['notes/**', ['notes/a.md', 'notes/deep/b.md', 'notes/deep/c.canvas']],
    ['**/*.md', ['README.md', 'notes/a.md', 'notes/deep/b.md', 'Ünïcode/ä.md']],
    ['notes/**/b.md', ['notes/deep/b.md']],
    ['**', paths],
    ['src/?.ts', ['src/x.ts']],
    ['src/[!x]*.ts', ['src/y.test.ts']],
    ['src/[a-x].ts', ['src/x.ts']],
    ['**/*.{canvas,ts}', ['notes/deep/c.canvas', 'src/x.ts', 'src/y.test.ts']],
    ['./notes/a.md', ['notes/a.md']],
    ['NOTES/**', []],
    ['notes/a\\.md', ['notes/a.md']],
    ['Ünïcode/*', ['Ünïcode/ä.md']],
  ])('%s matches whole root-relative paths case-sensitively', (pattern, expected) => {
    expect(matching(pattern)).toEqual(expected);
  });

  it('keeps * and ? within one segment and treats regular-expression characters literally', () => {
    expect(pathGlob('a*b')('a/b')).toBe(false);
    expect(pathGlob('a?b')('a/b')).toBe(false);
    expect(pathGlob('(x)+.md')('(x)+.md')).toBe(true);
    expect(pathGlob('[x')('[x')).toBe(true);
    expect(pathGlob('a,b}')('a,b}')).toBe(true);
  });

  it.each(['', '{a,b', 'trailing\\', 'x'.repeat(1025)])('rejects the malformed glob %j with INVALID_ARGUMENT', pattern => {
    expect(() => pathGlob(pattern)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('cursor paging', () => {
  const page = (limit: number | undefined, cursor?: string, items = ['a', 'b', 'c', 'd', 'e'], query: unknown = { q: 1 }) => {
    const pager = new Pager<string>({ limit, cursor }, query, item => [item]);
    for (const item of items) pager.offer(item);
    return { items: pager.items, total: pager.total, next: pager.nextCursor() };
  };

  it('pages in key order with an opaque cursor until the last page and counts every offered item', () => {
    const first = page(2);
    expect(first).toMatchObject({ items: ['a', 'b'], total: 5 });
    expect(first.next).toMatch(/^[A-Za-z0-9_-]+$/);
    const second = page(2, first.next);
    expect(second.items).toEqual(['c', 'd']);
    const last = page(2, second.next);
    expect(last).toEqual({ items: ['e'], total: 5, next: undefined });
    expect(page(undefined, first.next).items).toEqual(['c', 'd', 'e']);
  });

  it('continues after the last returned key when items were added or removed between pages', () => {
    const first = page(2);
    expect(page(2, first.next, ['a', 'bb', 'c', 'e']).items).toEqual(['bb', 'c']);
  });

  it('rejects malformed cursors, cursors of another query and invalid limits with INVALID_ARGUMENT', () => {
    const next = page(1).next!;
    for (const cursor of ['not a cursor', 'AAAA', next.slice(0, -2)]) expect(() => page(1, cursor)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => page(1, next, undefined, { q: 2 })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('different query') }));
    for (const limit of [0, -1, 1.5]) expect(() => page(limit)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('compares composite keys by element: strings by code unit, numbers numerically', () => {
    expect(compareKeys(['a.md', 2, 10], ['a.md', 10, 1])).toBeLessThan(0);
    expect(compareKeys(['B.md', 1], ['a.md', 1])).toBeLessThan(0);
    expect(compareKeys(['a.md', 3], ['a.md', 3])).toBe(0);
  });
});

describe('list with --path, --limit and --cursor', () => {
  const list = documentCommands().find(command => command.id === 'list')!;
  const context = { workspace: { files: new MemoryFiles(Object.fromEntries(paths.map(path => [path, '']))) } } as unknown as CommandContext;
  const run = (flags: Record<string, string>) => list.run([], flags, context) as Promise<{ files: Array<{ path: string; kind: string }>; nextCursor?: string }>;

  it('filters by glob and kind and pages in path order', async () => {
    expect((await run({ path: 'notes/**', kind: 'markdown' })).files).toEqual([{ path: 'notes/a.md', kind: 'markdown' }, { path: 'notes/deep/b.md', kind: 'markdown' }]);
    const first = await run({ path: '**/*.md', limit: '3' });
    expect(first.files.map(file => file.path)).toEqual(['README.md', 'notes/a.md', 'notes/deep/b.md']);
    const second = await run({ path: '**/*.md', limit: '3', cursor: first.nextCursor! });
    expect(second).toEqual({ files: [{ path: 'Ünïcode/ä.md', kind: 'markdown' }] });
    expect(await run({})).toEqual({ files: paths.map(path => ({ path, kind: expect.any(String) })) });
  });

  it('rejects a cursor from a different filter and non-positive limits', async () => {
    const { nextCursor } = await run({ limit: '1' });
    await expect(run({ path: '**', cursor: nextCursor! })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    for (const limit of ['0', '-1', 'ten']) await expect(run({ limit })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
