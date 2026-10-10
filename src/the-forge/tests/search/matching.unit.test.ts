import { describe, expect, it } from 'vitest';
import { clipAround, clipLine, frontmatterRange, matchLines, searchExpression, searchedLines, splitLines } from '../../src/plugins/search/domain/matching.ts';
import { metadataMatches, propertyFilter } from '../../src/plugins/search/domain/query.ts';
import type { CachedMetadata } from '../../src/domain/metadata/cache.ts';

const expression = (pattern: string, regex = false, caseSensitive = false) => searchExpression({ pattern, regex, caseSensitive });
const all = () => true;

describe('search expressions', () => {
  it('matches literal text case-insensitively by default, with every regular-expression character taken literally', () => {
    expect(matchLines(expression('a.b(c)'), ['A.B(C) and a.b(c)', 'axb(c)'], all)).toEqual([
      { line: 0, column: 0, match: 'A.B(C)' }, { line: 0, column: 11, match: 'a.b(c)' },
    ]);
    expect(matchLines(expression('Plan', false, true), ['plan Plan'], all)).toEqual([{ line: 0, column: 5, match: 'Plan' }]);
  });

  it('matches regular expressions per line with the u flag and skips empty matches', () => {
    expect(matchLines(expression('^#+ (\\w+)', true), ['# Title', 'text # Not', '## Two'], all)).toEqual([
      { line: 0, column: 0, match: '# Title' }, { line: 2, column: 0, match: '## Two' },
    ]);
    expect(matchLines(expression('x*', true), ['abxxc'], all)).toEqual([{ line: 0, column: 2, match: 'xx' }]);
    expect(matchLines(expression('\\p{Lu}', true, true), ['aÄb'], all)).toEqual([{ line: 0, column: 1, match: 'Ä' }]);
    expect(matchLines(expression('a*', true), ['😀a'], all)).toEqual([{ line: 0, column: 2, match: 'a' }]);
  });

  it.each([['', false], ['(', true], ['x'.repeat(1001), false], ['\\-', true]])('rejects the pattern %j with INVALID_SEARCH_PATTERN', (pattern, regex) => {
    expect(() => expression(pattern as string, regex as boolean)).toThrow(expect.objectContaining({ code: 'INVALID_SEARCH_PATTERN' }));
  });
});

describe('searched lines', () => {
  const note = splitLines('---\ntitle: Plan\ntags: [x]\n---\n# Plan\r\nBody plan\r```\nplan()\n```');

  it('splits lines like the metadata cache and finds leading frontmatter delimiters', () => {
    expect(note).toEqual(['---', 'title: Plan', 'tags: [x]', '---', '# Plan', 'Body plan', '```', 'plan()', '```']);
    expect(frontmatterRange(note)).toEqual({ start: 0, end: 3 });
    expect(frontmatterRange(['---', 'unclosed'])).toBeUndefined();
    expect(frontmatterRange(['# Title', '---'])).toBeUndefined();
  });

  it('reads the body, the frontmatter content or everything, and never skipped code lines', () => {
    const lines = (scope: 'body' | 'frontmatter' | 'all', skipped?: Set<number>) => note.map((_, index) => index).filter(searchedLines(note, 'markdown', scope, skipped));
    expect(lines('frontmatter')).toEqual([1, 2]);
    expect(lines('body')).toEqual([4, 5, 6, 7, 8]);
    expect(lines('all')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(lines('body', new Set([6, 7, 8]))).toEqual([4, 5]);
    expect(note.map((_, index) => index).filter(searchedLines(note, 'text', 'frontmatter'))).toEqual([]);
    expect(note.map((_, index) => index).filter(searchedLines(note, 'text', 'body'))).toHaveLength(note.length);
  });

  it('clips long lines around the match and long context lines at their start', () => {
    const line = `${'a'.repeat(300)}MATCH${'b'.repeat(300)}`;
    const snippet = clipAround(line, 300, 305);
    expect(snippet).toBe(`…${'a'.repeat(80)}MATCH${'b'.repeat(80)}…`);
    expect(clipAround('short line', 0, 5)).toBe('short line');
    expect(clipLine('c'.repeat(250))).toBe(`${'c'.repeat(200)}…`);
  });
});

describe('metadata filters', () => {
  const cache: CachedMetadata = {
    tags: [{ tag: '#Project/Alpha', position: { start: { line: 4, col: 0, offset: 0 }, end: { line: 4, col: 14, offset: 14 } } }],
    frontmatter: { status: 'done', points: 3, labels: ['a', 'b'], empty: null, tags: ['work'] },
  };

  it('matches nested tags case-insensitively with or without #', () => {
    for (const tag of ['project', '#PROJECT', 'project/alpha', 'work']) expect(metadataMatches(cache, { tag })).toBe(true);
    for (const tag of ['proj', 'alpha', 'project/alphabet']) expect(metadataMatches(cache, { tag })).toBe(false);
  });

  it('matches present properties and scalar or list values exactly', () => {
    expect(propertyFilter('status=done')).toEqual({ key: 'status', value: 'done' });
    expect(propertyFilter('formula=a=b')).toEqual({ key: 'formula', value: 'a=b' });
    expect(propertyFilter('=x')).toBeUndefined();
    const matches = (text: string) => metadataMatches(cache, { property: propertyFilter(text)! });
    expect(['status', 'status=done', 'points=3', 'labels=b'].map(matches)).toEqual([true, true, true, true]);
    expect(['status=Done', 'empty', 'missing', 'labels=c', 'points=03'].map(matches)).toEqual([false, false, false, false, false]);
    expect(metadataMatches(null, {})).toBe(true);
    expect(metadataMatches(null, { tag: 'x' })).toBe(false);
  });
});
