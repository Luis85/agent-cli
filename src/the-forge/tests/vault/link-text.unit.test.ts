import { describe, expect, it } from 'vitest';
import { linkIndex } from '../../src/domain/metadata/link-resolution.ts';
import {
  applyEdits, attributeDestination, definitionDestination, markdownDestination, relativePath, rewriteDestination, rewriteWikilink, vaultLinkpath, type TextEdit,
} from '../../src/domain/metadata/link-text.ts';

describe('relative paths and vault link paths', () => {
  it('never consumes the file name as a shared folder', () => {
    expect(relativePath('notes/Plan', 'notes/Plan')).toBe('../Plan');
    expect(relativePath('a/b', 'a/b/c.md')).toBe('c.md');
  });

  it('keeps a leading slash on full paths and drops it for a bare file name', () => {
    const index = linkIndex(['Index.md', 'specs/Roadmap.md', 'specs/Plan.md', 'docs/a.mdx']);
    expect(vaultLinkpath(index, '/notes/Plan', 'specs/Plan.md', 'Index.md')).toBe('/specs/Plan');
    expect(vaultLinkpath(index, '/notes/Plan.md', 'specs/Plan.md', 'Index.md')).toBe('/specs/Plan.md');
    expect(vaultLinkpath(index, '/Plan', 'specs/Roadmap.md', 'Index.md')).toBe('Roadmap');
    expect(vaultLinkpath(index, 'Plan.md', 'specs/Roadmap.md', 'Index.md')).toBe('Roadmap.md');
    expect(vaultLinkpath(index, 'docs/old', 'docs/a.mdx', 'Index.md')).toBe('docs/a.mdx');
  });
});

describe('wikilink rewriting', () => {
  it.each([
    ['[[Plan#Goals|g]]', 'Plan#Goals', '[[Roadmap#Goals|g]]'],
    ['![[Plan]]', 'Plan', '![[Roadmap]]'],
    ['[[Plan', 'Plan', undefined],
    ['[[Plancd', 'Plan', undefined],
    ['..Plan]]', 'Plan', undefined],
    ['[Plan]]', 'Plan', undefined],
    ['[[Other]]', 'Plan', undefined],
  ])('rewrites %s naming %s as %s', (original, link, expected) => {
    expect(rewriteWikilink(original, link, 'Roadmap')).toBe(expected);
  });
});

describe('destinations in source text', () => {
  it.each([
    ['[a](\tPlan.md)', 'Plan.md'],
    ['[a](\nPlan.md)', 'Plan.md'],
    ['[a](a\\)b.md)', 'a\\)b.md'],
    ["[a](b 'ti')", 'b'],
    ['[a](b (ti))', 'b'],
    ['[a](b "t" )', 'b'],
    ['[a](b "ti")', 'b'],
  ])('finds the Markdown destination of %j', (original, raw) => {
    expect(markdownDestination(original)).toMatchObject({ raw });
  });

  it.each(['[a](<Plan.md)', '[a]()', '[a](b x', '[a](b c)', '[a](b c "t")', '[a](b "t" c)', '[a](b) x'])('finds no Markdown destination in %j', original => {
    expect(markdownDestination(original)).toBeUndefined();
  });

  it('finds reference definition destinations only at the start of a line with up to three spaces', () => {
    expect(definitionDestination('   [ref]: a.md')).toMatchObject({ raw: 'a.md', start: 10, end: 14 });
    expect(definitionDestination('x [r]: a.md')).toBeUndefined();
    expect(definitionDestination('[]: a.md')).toBeUndefined();
  });

  it('finds quoted, unquoted and empty attribute values', () => {
    expect(attributeDestination('src=img/a.png')).toEqual({ start: 4, end: 13, raw: 'img/a.png', angle: false });
    expect(attributeDestination('src=a.png title')).toMatchObject({ raw: 'a.png' });
    expect(attributeDestination('href=""')).toMatchObject({ raw: '', start: 6, end: 6 });
    expect(attributeDestination('href="a.md')).toBeUndefined();
    expect(attributeDestination('nothing')).toBeUndefined();
  });
});

describe('destination rewriting', () => {
  const at = (raw: string, angle = false) => ({ start: 0, end: raw.length, raw, angle });

  it('keeps vault paths vault-relative and relative paths relative to the new folder', () => {
    expect(rewriteDestination(at('specs/Plan.md'), 'notes/Index.md', 'specs/Plan.md', 'notes/Index.md', 'archive/Plan.md')).toBe('archive/Plan.md');
    expect(rewriteDestination(at('Plan'), 'notes/Index.md', 'notes/Plan.md', 'notes/Index.md', 'specs/Plan.md')).toBe('../specs/Plan');
    expect(rewriteDestination(at('./Plan.md'), 'notes/Index.md', 'notes/Plan.md', 'notes/Index.md', 'notes/sub/Plan.md')).toBe('./sub/Plan.md');
    expect(rewriteDestination(at('./notes/Plan.md'), 'Index.md', 'notes/Plan.md', 'Index.md', 'notes/Roadmap.md')).toBe('./notes/Roadmap.md');
  });

  it('percent-encodes only destinations that were encoded or would contain whitespace', () => {
    expect(rewriteDestination(at('Plan.md'), 'Index.md', 'Plan.md', 'Index.md', 'Plän.md')).toBe('Plän.md');
    expect(rewriteDestination(at('My%20Plan.md'), 'Index.md', 'My Plan.md', 'Index.md', 'Plän.md')).toBe('Pl%C3%A4n.md');
    expect(rewriteDestination(at('Plan.md'), 'Index.md', 'Plan.md', 'Index.md', 'My Plan.md')).toBe('My%20Plan.md');
    expect(rewriteDestination(at('Plan.md', true), 'Index.md', 'Plan.md', 'Index.md', 'My Plan.md')).toBe('My Plan.md');
  });

  it('reads a destination that is not valid percent-encoding as written', () => {
    expect(rewriteDestination(at('100%.md'), 'Index.md', '100%.md', 'Index.md', 'new.md')).toBe('new.md');
  });
});

describe('applying edits', () => {
  /** Deterministic pseudo-random text over a small alphabet, so shared prefixes and suffixes are common. */
  function generator(seed: number) {
    const next = (limit: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % limit; };
    return { next, text: (length: number) => Array.from({ length }, () => 'ab'[next(2)]).join('') };
  }

  it('applies a single edit exactly as a splice of the text', () => {
    const random = generator(5);
    for (let round = 0; round < 500; round++) {
      const text = random.text(random.next(8));
      const start = random.next(text.length + 1), end = start + random.next(text.length - start + 1);
      const edit = { start, end, original: text.slice(start, end), text: random.text(random.next(5)) };
      expect(applyEdits(text, [edit]), JSON.stringify({ text, edit })).toEqual({ text: text.slice(0, start) + edit.text + text.slice(end), skipped: [] });
    }
  });

  it('applies adjacent edits, a repeated change once, and keeps the outer edit of two starting together', () => {
    expect(applyEdits('abcd', [{ start: 0, end: 2, original: 'ab', text: 'X' }, { start: 2, end: 4, original: 'cd', text: 'Y' }])).toEqual({ text: 'XY', skipped: [] });
    const change = { start: 2, end: 7, original: '[[x]]', text: '[[y]]' };
    expect(applyEdits('a [[x]] b', [change, { ...change }])).toEqual({ text: 'a [[y]] b', skipped: [] });
    const outer: TextEdit = { start: 2, end: 5, original: 'abc', text: 'ZZZ' }, inner: TextEdit = { start: 2, end: 3, original: 'a', text: 'Q' };
    expect(applyEdits('xxabcxx', [inner, outer])).toEqual({ text: 'xxZZZxx', skipped: [inner] });
    expect(applyEdits('xxabcxx', [outer, inner])).toEqual({ text: 'xxZZZxx', skipped: [inner] });
  });

  it('skips edits that overlap an applied one even when they make the same change at the same end', () => {
    const late: TextEdit = { start: 2, end: 4, original: 'bc', text: 'Q' }, early: TextEdit = { start: 1, end: 4, original: 'abc', text: 'Q' };
    expect(applyEdits('xabcx', [early, late])).toEqual({ text: 'xaQx', skipped: [early] });
    const long: TextEdit = { start: 2, end: 5, original: 'abc', text: 'Q' }, short: TextEdit = { start: 2, end: 3, original: 'a', text: 'Q' };
    expect(applyEdits('xxabcxx', [long, short])).toEqual({ text: 'xxQxx', skipped: [short] });
  });
});
