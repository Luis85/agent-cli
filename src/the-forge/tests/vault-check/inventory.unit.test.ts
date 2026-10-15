import { describe, expect, it } from 'vitest';
import { conflicts, dominantType, propertyInventory, propertyUses, tagInventory, type PropertyUse } from '../../src/plugins/vault-check/domain/inventory.ts';
import type { PropertyType } from '../../src/plugins/vault-check/domain/property-types.ts';

const uses = (...types: Array<PropertyType | null>): PropertyUse[] => types.map((type, index) => ({ path: `${index}.md`, type }));

describe('tag inventory', () => {
  it('rolls nested tags up to their parents, folds case and sorts by name or count', () => {
    const notes = [
      { path: 'b.md', tags: ['#Project/alpha', '#idea'] },
      { path: 'a.md', tags: ['#project', '#project/beta/deep'] },
    ];
    expect(tagInventory(notes, 'name')).toStrictEqual([
      { tag: '#idea', count: 1, files: ['b.md'] },
      { tag: '#project', count: 2, files: ['a.md', 'b.md'] },
      { tag: '#Project/alpha', count: 1, files: ['b.md'] },
      { tag: '#project/beta', count: 1, files: ['a.md'] },
      { tag: '#project/beta/deep', count: 1, files: ['a.md'] },
    ]);
    expect(tagInventory(notes, 'count').map(entry => entry.tag)).toStrictEqual(['#project', '#idea', '#Project/alpha', '#project/beta', '#project/beta/deep']);
  });

  it('ignores empty tag segments and counts a note once per tag', () => {
    expect(tagInventory([{ path: 'a.md', tags: ['#a//b/', '#a/b', 'a'] }], 'name')).toStrictEqual([
      { tag: '#a', count: 1, files: ['a.md'] },
      { tag: '#a/b', count: 1, files: ['a.md'] },
    ]);
    expect(tagInventory([{ path: 'a.md', tags: ['#', '#/'] }], 'name')).toStrictEqual([]);
  });

  it('sorts tags by name ignoring case and keeps the spelling seen first in path order', () => {
    const notes = [{ path: 'b.md', tags: ['#AB', '#a_b'] }, { path: 'a.md', tags: ['#Ab'] }];
    expect(tagInventory(notes, 'name')).toStrictEqual([
      { tag: '#a_b', count: 1, files: ['b.md'] },
      { tag: '#Ab', count: 2, files: ['a.md', 'b.md'] },
    ]);
  });

  it('puts the most used tags first and breaks ties by name', () => {
    const notes = [{ path: 'a.md', tags: ['#z', '#m'] }, { path: 'b.md', tags: ['#b', '#m'] }, { path: 'c.md', tags: ['#y'] }];
    expect(tagInventory(notes, 'count').map(({ tag, count }) => [tag, count])).toStrictEqual([['#m', 2], ['#b', 1], ['#y', 1], ['#z', 1]]);
  });
});

describe('property uses and types', () => {
  it('lists each property value type in path order', () => {
    const result = propertyUses([{ path: 'b.md', properties: { due: '2024-05-01', tags: [] } }, { path: 'a.md', properties: { due: null } }]);
    expect([...result]).toStrictEqual([
      ['due', [{ path: 'a.md', type: null }, { path: 'b.md', type: 'date' }]],
      ['tags', [{ path: 'b.md', type: 'list' }]],
    ]);
  });

  it.each([
    [[], null],
    [[null, null], null],
    [[null, null, 'text'], 'text'],
    [['text', 'number', 'number'], 'number'],
    [['number', 'text'], 'number'],
    [['text', null, 'number', 'list', 'number', 'text', 'text'], 'text'],
  ] as Array<[Array<PropertyType | null>, PropertyType | null]>)('infers the dominant type of %j as %s', (types, dominant) => {
    expect(dominantType(uses(...types))).toBe(dominant);
  });

  it.each([
    [null, 'number', 'text', false],
    [null, null, 'text', false],
    ['text', 'number', 'text', true],
    ['date', 'text', 'number', false],
    ['number', 'multitext', 'number', true],
    ['list', 'multitext', 'text', false],
    ['object', 'rating', 'text', false],
    ['text', null, 'text', false],
    ['number', null, 'text', true],
    ['number', null, null, false],
  ] as Array<[PropertyType | null, string | null, PropertyType | null, boolean]>)(
    'a %s value with declared type %s and dominant type %s conflicts: %s', (type, declared, dominant, conflicting) => {
      expect(conflicts(type, declared, dominant)).toBe(conflicting);
    });
});

describe('property inventory', () => {
  it('infers each property from its most frequent type, ties to the type seen first in path order, sorted by name ignoring case', () => {
    const list = propertyUses([
      { path: 'c.md', properties: { status: 'done' } },
      { path: 'a.md', properties: { status: 1, tags: [] } },
      { path: 'b.md', properties: { status: null, Status: 'x' } },
    ]);
    expect(dominantType(list.get('status')!)).toBe('number');
    expect(propertyInventory(list, { status: 'text' }, true)).toStrictEqual([
      { name: 'Status', count: 1, empty: 0, types: { text: 1 }, type: 'text', declared: null, conflicting: false, files: [{ path: 'b.md', type: 'text' }] },
      { name: 'status', count: 3, empty: 1, types: { text: 1, number: 1 }, type: 'number', declared: 'text', conflicting: true, files: [{ path: 'a.md', type: 'number' }, { path: 'b.md', type: null }, { path: 'c.md', type: 'text' }] },
      { name: 'tags', count: 1, empty: 0, types: { list: 1 }, type: 'list', declared: null, conflicting: false, files: [{ path: 'a.md', type: 'list' }] },
    ]);
  });

  it('orders names that differ only in case by their exact spelling', () => {
    const list = propertyUses([{ path: 'a.md', properties: { Status: 'x', b: 1 } }, { path: 'b.md', properties: { status: 'y', A: 2 } }]);
    expect(propertyInventory(list, {}, false).map(entry => entry.name)).toStrictEqual(['A', 'b', 'Status', 'status']);
  });

  it('reports values that conflict with the dominant type and leaves out files unless asked', () => {
    const list = propertyUses([
      { path: 'a.md', properties: { rank: 1, done: true } },
      { path: 'b.md', properties: { rank: 'high', done: null } },
      { path: 'c.md', properties: { rank: 2, done: false, toString: 'x' } },
    ]);
    expect(propertyInventory(list, {}, false)).toStrictEqual([
      { name: 'done', count: 3, empty: 1, types: { checkbox: 2 }, type: 'checkbox', declared: null, conflicting: false },
      { name: 'rank', count: 3, empty: 0, types: { text: 1, number: 2 }, type: 'number', declared: null, conflicting: true },
      { name: 'toString', count: 1, empty: 0, types: { text: 1 }, type: 'text', declared: null, conflicting: false },
    ]);
  });
});
