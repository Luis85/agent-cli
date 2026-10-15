import { describe, expect, it } from 'vitest';
import { compareKeys, Pager, type PageKey } from '../../src/domain/shared/paging.ts';

/** One page of `items` keyed by `key`, as a command collects it. */
function page<Item>(items: readonly Item[], key: (item: Item) => PageKey, request: { limit?: number; cursor?: string }, query: unknown = { q: 1 }) {
  const pager = new Pager<Item>(request, query, key);
  for (const item of items) pager.offer(item);
  return { items: pager.items, total: pager.total, next: pager.nextCursor() };
}
const single = (item: string) => [item];
/** A cursor as a client could tamper with it: base64url JSON with the query fingerprint `q` and the last key `after`. */
const decoded = (cursor: string) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { q: string; after: unknown };
const encoded = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');

describe('cursor round trips', () => {
  it('continues after keys of every length and script, so each cursor encoding length decodes', () => {
    const keys = ['a', 'ab', 'abc', 'abcd', 'ä', '😀', 'x'.repeat(50), 'ab😀cd'];
    for (const key of keys) {
      const items = [key, `${key}~`, `${key}~~`];
      const first = page(items, single, { limit: 1 });
      expect(first.items, key).toEqual([key]);
      expect(page(items, single, { limit: 1, cursor: first.next })).toMatchObject({ items: [`${key}~`], total: 3 });
    }
  });

  it('pages composite keys of strings and numbers', () => {
    const items = [{ path: 'a.md', line: 2 }, { path: 'a.md', line: 10 }, { path: 'b.md', line: 1 }];
    const key = (item: { path: string; line: number }) => [item.path, item.line];
    const first = page(items, key, { limit: 1 });
    expect(decoded(first.next!).after).toEqual(['a.md', 2]);
    expect(page(items, key, { limit: 5, cursor: first.next }).items).toEqual(items.slice(1));
  });

  it('returns no cursor when the limit holds every item, and offers nothing after a full page', () => {
    expect(page(['a', 'b'], single, { limit: 2 })).toEqual({ items: ['a', 'b'], total: 2, next: undefined });
    expect(page(['a', 'b'], single, {})).toEqual({ items: ['a', 'b'], total: 2, next: undefined });
  });
});

describe('cursor validation', () => {
  const rejected = (cursor: string, query: unknown = { q: 1 }) => () => page(['a', 'b', 'c'], single, { limit: 1, cursor }, query);
  const notOurs = expect.objectContaining({ code: 'INVALID_ARGUMENT', message: '--cursor is not a cursor returned by this command; rerun without --cursor.' });

  it('rejects cursors with extra characters or bytes that are not UTF-8', () => {
    const cursors = ['a', 'ab', 'abc', 'abcd', 'abcde'].map(key => page([key, `${key}~`], single, { limit: 1 }).next!);
    const aligned = cursors.filter(cursor => cursor.length % 4 === 0);
    expect(aligned.length).toBeGreaterThan(0);
    for (const cursor of aligned) expect(rejected(`${cursor}A`), cursor).toThrow(notOurs);
    const { q } = decoded(cursors[0]!);
    const invalid = new Uint8Array([...new TextEncoder().encode(`{"q":"${q}","after":["`), 0xff, ...new TextEncoder().encode('"]}')]);
    expect(rejected(encoded(invalid))).toThrow(notOurs);
    expect(rejected('ab+c')).toThrow(notOurs);
  });

  it('accepts only non-empty keys of strings and safe integers', () => {
    const { q } = decoded(page(['a', 'b'], single, { limit: 1 }).next!);
    const cursor = (after: unknown) => encoded(JSON.stringify({ q, after }));
    expect(page(['a', 'b', 'c'], single, { limit: 1, cursor: cursor(['a']) }).items).toEqual(['b']);
    for (const after of [[], 'a', {}, [1.5], [2 ** 53], ['a', {}], [null], [true]]) expect(rejected(cursor(after)), JSON.stringify(after)).toThrow(notOurs);
    expect(rejected(encoded(JSON.stringify({ q })))).toThrow(notOurs);
    expect(rejected(encoded('[1]'))).toThrow(notOurs);
  });

  it('rejects a cursor of another query and invalid limits with their own messages', () => {
    const next = page(['a', 'b'], single, { limit: 1 }).next!;
    expect(rejected(next, { q: 2 })).toThrow(expect.objectContaining({
      code: 'INVALID_ARGUMENT', message: '--cursor belongs to a different query; pass the same pattern and filters, or rerun without --cursor.',
    }));
    expect(() => page(['a'], single, { limit: 0 })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: '--limit must be a positive integer.' }));
  });
});

describe('key order', () => {
  it.each<[PageKey, PageKey, number]>([
    [['a'], ['a', 'b'], -1],
    [['a', 'b'], ['a'], 1],
    [[10], [9], 1],
    [[2], ['10'], 1],
    [['b'], [1], 1],
    [[1], ['b'], -1],
    [['a', 1], ['a', 1], 0],
  ])('compares %j with %j', (a, b, sign) => {
    expect(Math.sign(compareKeys(a, b))).toBe(sign);
  });
});
