import { describe, expect, it } from 'vitest';
import { clipAround, clipLine, frontmatterRange, matchLines, searchExpression, searchedLines, splitLines } from '../../src/plugins/search/domain/matching.ts';
import { metadataMatches, propertyFilter, searchError, searchScopes } from '../../src/plugins/search/domain/query.ts';
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

  it('accepts patterns of up to 1000 characters and explains the bound', () => {
    expect(matchLines(expression('x'.repeat(1000)), ['x'.repeat(1000)], all)).toHaveLength(1);
    expect(() => expression('')).toThrow(expect.objectContaining({ message: 'The pattern must have 1 to 1000 characters.' }));
  });

  it('advances past empty matches by one code unit in the Basic Multilingual Plane', () => {
    expect(matchLines(expression('b*', true), ['ab'], all)).toEqual([{ line: 0, column: 1, match: 'b' }]);
    expect(matchLines(expression('x*', true), ['￿x'], all)).toEqual([{ line: 0, column: 1, match: 'x' }]);
  });

  it('reports matches only on included lines', () => {
    expect(matchLines(expression('a'), ['a', 'a', 'a'], line => line !== 1)).toEqual([{ line: 0, column: 0, match: 'a' }, { line: 2, column: 0, match: 'a' }]);
  });

  it('names a regular expression syntax error once', () => {
    expect(() => expression('[', true)).toThrow(expect.objectContaining({ message: expect.stringMatching(/^Invalid regular expression: \/\[\/[a-z]*: /) }));
    expect(() => expression('[', true)).toThrow(expect.objectContaining({ message: expect.not.stringMatching(/Invalid regular expression.*Invalid regular expression/) }));
  });
});

describe('searched lines', () => {
  const noteLines = () => splitLines('---\ntitle: Plan\ntags: [x]\n---\n# Plan\r\nBody plan\r```\nplan()\n```');

  it('splits lines like the metadata cache and finds leading frontmatter delimiters', () => {
    const note = noteLines();
    expect(note).toEqual(['---', 'title: Plan', 'tags: [x]', '---', '# Plan', 'Body plan', '```', 'plan()', '```']);
    expect(frontmatterRange(note)).toEqual({ start: 0, end: 3 });
    expect(frontmatterRange(['---', 'unclosed'])).toBeUndefined();
    expect(frontmatterRange(['# Title', '---'])).toBeUndefined();
  });

  it('finds empty frontmatter and allows trailing but not leading whitespace around delimiters', () => {
    expect(frontmatterRange(['---', '---'])).toEqual({ start: 0, end: 1 });
    expect(frontmatterRange(['--- ', 'a', '---  '])).toEqual({ start: 0, end: 2 });
    expect(frontmatterRange(['  ---', 'a', '---'])).toBeUndefined();
    expect(frontmatterRange(['---', 'a', '  ---'])).toBeUndefined();
    expect(frontmatterRange(['---'])).toBeUndefined();
  });

  it('reads the body, the frontmatter content or everything, and never skipped code lines', () => {
    const note = noteLines();
    const lines = (scope: 'body' | 'frontmatter' | 'all', skipped?: Set<number>) => note.map((_, index) => index).filter(searchedLines(note, 'markdown', scope, skipped));
    expect(lines('frontmatter')).toEqual([1, 2]);
    expect(lines('body')).toEqual([4, 5, 6, 7, 8]);
    expect(lines('all')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(lines('body', new Set([6, 7, 8]))).toEqual([4, 5]);
    // The --scope values, in the order help lists them.
    expect(searchScopes).toEqual(['body', 'frontmatter', 'all']);
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

  it('keeps lines of up to 200 characters whole and marks only the clipped ends', () => {
    expect(clipAround('a'.repeat(200), 150, 155)).toBe('a'.repeat(200));
    expect(clipLine('c'.repeat(200))).toBe('c'.repeat(200));
    expect(clipAround('a'.repeat(300), 0, 5)).toBe(`${'a'.repeat(85)}…`);
    expect(clipAround('a'.repeat(300), 295, 300)).toBe(`…${'a'.repeat(85)}`);
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

  it('trims the key, keeps the value verbatim and compares only scalar values, booleans included', () => {
    expect(propertyFilter(' status = x')).toEqual({ key: 'status', value: ' x' });
    const flags: CachedMetadata = { frontmatter: { done: true, nested: ['a', ['b']] } };
    expect(metadataMatches(flags, { property: { key: 'done', value: 'true' } })).toBe(true);
    expect(metadataMatches(flags, { property: { key: 'nested', value: 'a' } })).toBe(true);
    expect(metadataMatches(flags, { property: { key: 'nested', value: 'b' } })).toBe(false);
    expect(metadataMatches(null, { property: { key: 'done' } })).toBe(false);
  });

  it('builds plugin errors with details only when given', () => {
    expect(searchError('SEARCH_TIMEOUT', 'Too slow.', { files: 3 })).toMatchObject({ code: 'SEARCH_TIMEOUT', message: 'Too slow.', details: { files: 3 } });
    expect(searchError('SEARCH_TIMEOUT', 'Too slow.')).not.toHaveProperty('details');
  });
});
