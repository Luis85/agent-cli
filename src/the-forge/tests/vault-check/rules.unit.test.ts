import { describe, expect, it } from 'vitest';
import type { CachedMetadata } from '../../src/domain/metadata/cache.ts';
import { missingAnchor } from '../../src/plugins/vault-check/domain/anchors.ts';
import { dominantType, propertyInventory, propertyUses, tagInventory } from '../../src/plugins/vault-check/domain/inventory.ts';
import { acceptsType, inferPropertyType, typeRegistry } from '../../src/plugins/vault-check/domain/property-types.ts';
import { compareFindings, effectiveSeverities, ruleDefaults, ruleIds, type Finding } from '../../src/plugins/vault-check/domain/rules.ts';
import { closestFile } from '../../src/plugins/vault-check/domain/suggestion.ts';
import { fill } from '../../src/plugins/vault-check/presentation/messages.ts';

const at = { position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } };

describe('property types', () => {
  it('infers Obsidian property types from frontmatter values', () => {
    expect([null, '', 'draft', 3, true, ['a'], { a: 1 }, '2024-05-01', '2024-05-01T10:30', '2024-05-01T10:30:00Z', '2024-5-1'].map(inferPropertyType))
      .toEqual([null, null, 'text', 'number', 'checkbox', 'list', 'object', 'date', 'datetime', 'datetime', 'text']);
  });

  it('accepts values that fit a declared types.json type and ignores unknown type names', () => {
    expect(acceptsType('text', 'date')).toBe(true);
    expect(acceptsType('multitext', 'text')).toBe(false);
    expect(acceptsType('tags', 'text')).toBe(true);
    expect(acceptsType('datetime', 'date')).toBe(true);
    expect(acceptsType('date', 'datetime')).toBe(false);
    expect(acceptsType('number', 'text')).toBe(false);
    expect(acceptsType('rating', 'object')).toBe(true);
  });

  it('reads .obsidian/types.json and reports why an invalid registry declares nothing', () => {
    expect(typeRegistry(null)).toEqual({ status: 'missing', types: {} });
    expect(typeRegistry('\uFEFF{"types":{"status":"text","n":3}}')).toEqual({ status: 'loaded', types: { status: 'text' } });
    expect(typeRegistry('{oops')).toEqual({ status: 'invalid', types: {}, reason: 'json' });
    expect(typeRegistry('{"status":"text"}')).toEqual({ status: 'invalid', types: {}, reason: 'shape' });
  });

  it('infers each property from its most frequent type, ties to the type seen first in path order, sorted by name ignoring case', () => {
    const uses = propertyUses([
      { path: 'c.md', properties: { status: 'done' } },
      { path: 'a.md', properties: { status: 1, tags: [] } },
      { path: 'b.md', properties: { status: null, Status: 'x' } },
    ]);
    expect(dominantType(uses.get('status')!)).toBe('number');
    expect(propertyInventory(uses, { status: 'text' }, true)).toEqual([
      { name: 'Status', count: 1, empty: 0, types: { text: 1 }, type: 'text', declared: null, conflicting: false, files: [{ path: 'b.md', type: 'text' }] },
      { name: 'status', count: 3, empty: 1, types: { text: 1, number: 1 }, type: 'number', declared: 'text', conflicting: true, files: [{ path: 'a.md', type: 'number' }, { path: 'b.md', type: null }, { path: 'c.md', type: 'text' }] },
      { name: 'tags', count: 1, empty: 0, types: { list: 1 }, type: 'list', declared: null, conflicting: false, files: [{ path: 'a.md', type: 'list' }] },
    ]);
  });
});

describe('tag inventory', () => {
  it('rolls nested tags up to their parents, folds case and sorts by name or count', () => {
    const notes = [
      { path: 'b.md', tags: ['#Project/alpha', '#idea'] },
      { path: 'a.md', tags: ['#project', '#project/beta/deep'] },
    ];
    expect(tagInventory(notes, 'name')).toEqual([
      { tag: '#idea', count: 1, files: ['b.md'] },
      { tag: '#project', count: 2, files: ['a.md', 'b.md'] },
      { tag: '#Project/alpha', count: 1, files: ['b.md'] },
      { tag: '#project/beta', count: 1, files: ['a.md'] },
      { tag: '#project/beta/deep', count: 1, files: ['a.md'] },
    ]);
    expect(tagInventory(notes, 'count').map(entry => entry.tag)).toEqual(['#project', '#idea', '#Project/alpha', '#project/beta', '#project/beta/deep']);
  });
});

describe('anchors', () => {
  const cache: CachedMetadata = {
    headings: [{ heading: 'Plan', level: 1, ...at }, { heading: '`vault check` (strict)', level: 2, ...at }, { heading: 'Risks & Größe', level: 2, ...at }],
    blocks: { 'ref-1': { id: 'Ref-1', ...at } },
  };

  it('finds headings by text, URL-encoded text or GitHub slug, and block ids without case', () => {
    for (const subpath of ['#Plan', '#plan', '#Plan#Risks & Größe', '#vault-check-strict', '#`vault check` (strict)', '#Risks%20%26%20Gr%C3%B6%C3%9Fe', '#risks--größe', '#plan-1', '#^REF-1', '#']) {
      expect(missingAnchor(subpath, cache), subpath).toBeNull();
    }
  });

  it('names the first missing part of a heading path or a missing block', () => {
    expect(missingAnchor('#Plan#Budget', cache)).toBe('#Budget');
    expect(missingAnchor('#Budget#Plan', cache)).toBe('#Budget');
    expect(missingAnchor('#^nope', cache)).toBe('#^nope');
    expect(missingAnchor('#^ref-1', {})).toBe('#^ref-1');
  });
});

describe('closest file suggestions', () => {
  const paths = ['Projects/Alpha.md', 'Notes/Alpha Plan.md', 'assets/diagram.png', 'Deep/Nested/alpha.md'];

  it('suggests the nearest file name, ignoring case and .md, preferring shallow paths', () => {
    expect(closestFile('Projects/Alpah', paths)).toBe('Projects/Alpha.md');
    expect(closestFile('alpha', paths)).toBe('Projects/Alpha.md');
    expect(closestFile('diagramm.png', paths)).toBe('assets/diagram.png');
    expect(closestFile('Alpha Plna.md', paths)).toBe('Notes/Alpha Plan.md');
  });

  it('suggests nothing beyond a third of the name length', () => {
    expect(closestFile('Roadmap', paths)).toBeUndefined();
    expect(closestFile('', paths)).toBeUndefined();
  });
});

describe('rules and findings', () => {
  it('overrides default severities from settings', () => {
    expect(effectiveSeverities({ 'empty-file': 'off', 'orphan-attachment': 'warning' })).toEqual({ ...ruleDefaults, 'empty-file': 'off', 'orphan-attachment': 'warning' });
    expect(ruleIds[0]).toBe('unresolved-link');
  });

  it('orders findings by path, line, column, rule and message', () => {
    const finding = (path: string, line: number | null, rule: Finding['rule'], message = 'm'): Finding => ({ rule, severity: 'error', path, line, column: line, message, hint: '' });
    const sorted = [finding('b.md', 1, 'unresolved-link'), finding('a.md', 2, 'unresolved-link'), finding('a.md', null, 'empty-file'), finding('a.md', 2, 'unresolved-link', 'a'), finding('a.md', 2, 'unresolved-embed')].sort(compareFindings);
    expect(sorted.map(item => [item.path, item.line, item.rule, item.message])).toEqual([
      ['a.md', null, 'empty-file', 'm'], ['a.md', 2, 'unresolved-link', 'a'], ['a.md', 2, 'unresolved-link', 'm'], ['a.md', 2, 'unresolved-embed', 'm'], ['b.md', 1, 'unresolved-link', 'm'],
    ]);
  });

  it('fills message placeholders once and keeps unknown ones', () => {
    expect(fill('Link {original} in {at}; {unknown}', { original: '[[{at}]]', at: 'x' })).toBe('Link [[{at}]] in x; {unknown}');
  });
});
