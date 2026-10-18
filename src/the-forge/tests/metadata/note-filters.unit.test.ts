import { describe, expect, it } from 'vitest';
import { metadataMatches, noteFilters, propertyFilter } from '../../src/domain/metadata/note-filters.ts';
import type { CachedMetadata } from '../../src/domain/metadata/cache.ts';

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

  it('reads --tag and --property option values and refuses an empty tag or key', () => {
    expect(noteFilters(undefined, undefined)).toEqual({});
    expect(noteFilters('#work', 'status=done')).toEqual({ tag: '#work', property: { key: 'status', value: 'done' } });
    expect(() => noteFilters('#', undefined)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: '--tag must name a tag.' }));
    expect(() => noteFilters(undefined, '=x')).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT', message: '--property must be key or key=value with a nonempty key.' }));
  });
});
