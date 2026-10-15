import { describe, expect, it } from 'vitest';
import type { CachedMetadata } from '../../src/domain/metadata/cache.ts';
import { missingAnchor } from '../../src/plugins/vault-check/domain/anchors.ts';

const at = { position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } };

/** A note with headings and one block, built inside each test so the anchor code under test reads it fresh. */
function note(headings = ['Plan', '`vault check` (strict)', 'Risks & Größe', '50%', 'Café']): CachedMetadata {
  return {
    headings: headings.map((heading, index) => ({ heading, level: index === 0 ? 1 : 2, ...at })),
    blocks: { 'ref-1': { id: 'Ref-1', ...at } },
  };
}

describe('link anchors', () => {
  it.each([
    '#Plan', '#plan', '#PLAN', '#Plan#Risks & Größe', '#vault-check-strict', '#`vault check` (strict)', '#Risks%20%26%20Gr%C3%B6%C3%9Fe',
    '#risks--größe', '#plan-1', '#plan-12', '#Plan 3', '#^REF-1', '#^ref%2D1', '#', '##', '#Plan#', '#50%', '#50', '#Cafe\u0301', '#café',
  ])('finds %s by heading text, URL-encoded text, GitHub slug, repeated-heading suffix or block id', subpath => {
    expect(missingAnchor(subpath, note())).toBeNull();
  });

  it.each([
    ['#Plan#Budget', '#Budget'],
    ['#Budget#Plan', '#Budget'],
    ['#Plan-2-Extra', '#Plan-2-Extra'],
    ['#Plan-x', '#Plan-x'],
    ['#Plan2', '#Plan2'],
    ['#^nope', '#^nope'],
    ['#^', '#^'],
    ['#^Plan', '#^Plan'],
    ['#%', '#%'],
    ['#Risks & Grösse', '#Risks & Grösse'],
  ])('names the first missing part of %s', (subpath, missing) => {
    expect(missingAnchor(subpath, note())).toBe(missing);
  });

  it.each(['#Plan', '#undefined', '#^ref-1'])('reports %s missing in a note without headings or blocks', subpath => {
    expect(missingAnchor(subpath, {})).toBe(subpath);
  });

  it('checks only the block of a heading path that ends with a block id', () => {
    expect(missingAnchor('#Plan#^ref-1', note())).toBeNull();
    expect(missingAnchor('#Plan#^other', note())).toBe('#^other');
  });

  it('reads the headings of each metadata object it is given', () => {
    expect(missingAnchor('#Budget', note(['Plan']))).toBe('#Budget');
    expect(missingAnchor('#Budget', note(['Budget']))).toBeNull();
  });
});
