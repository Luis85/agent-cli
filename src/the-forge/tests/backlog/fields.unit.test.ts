import { describe, expect, it } from 'vitest';
import {
  addDays, daysBetween, declaredSpelling, formatCivil, hasTag, linkpathFromRawValue, normalizeTag, ownValue, readDate, readNumber,
  readPlacement, readSoleDate, readString, readTags, reversedSpan, sameCivil, sameValue, setOwn, typedTags, type CivilDate,
} from '../../src/plugins/backlog/domain/fields.ts';

const civil = (year: number, month: number, day: number): CivilDate => ({ year, month, day });
const valid = (year: number, month: number, day: number) => ({ value: civil(year, month, day), invalid: false });
const absent = { value: null, invalid: false };
const invalid = { value: null, invalid: true };

describe('own frontmatter keys', () => {
  it('reads only keys the note itself holds', () => {
    expect(ownValue({ '': 'empty key', a: 1 }, '')).toBeUndefined();
    expect(ownValue({ a: 1 }, 'a')).toBe(1);
    expect(ownValue({ a: 1 }, 'toString')).toBeUndefined();
    expect(ownValue(undefined, 'a')).toBeUndefined();
  });

  it('writes a plain, editable data property, even for __proto__', () => {
    const frontmatter: Record<string, unknown> = {};
    setOwn(frontmatter, '__proto__', 'x');
    setOwn(frontmatter, 'k', 1);
    expect(Object.getPrototypeOf(frontmatter)).toBe(Object.prototype);
    expect(Object.keys(frontmatter)).toStrictEqual(['__proto__', 'k']);
    expect(Object.getOwnPropertyDescriptor(frontmatter, 'k')).toStrictEqual({ value: 1, writable: true, enumerable: true, configurable: true });
    frontmatter.k = 2;
    expect(frontmatter.k).toBe(2);
    delete frontmatter.k;
    expect(Object.keys(frontmatter)).toStrictEqual(['__proto__']);
  });
});

describe('scalar readers', () => {
  it.each<[unknown, string | null]>([
    [' Active ', 'Active'], ['', null], ['   ', null], [['a', 'b'], 'a'], [[], null], [[' '], null], [[['x']], 'x'],
    [3, '3'], [true, 'true'], [false, 'false'], [null, null], [undefined, null], [{}, null],
  ])('readString(%j) is %j', (value, expected) => {
    expect(readString(value)).toBe(expected);
  });

  it.each<[unknown, number | null]>([
    [5, 5], [-2.5, -2.5], [Number.NaN, null], [Number.POSITIVE_INFINITY, null], ['3.5x', 3.5], [' 7', 7], ['x', null], ['Infinity', null],
    [['5'], null], [true, null], [null, null],
  ])('readNumber(%j) is %j', (value, expected) => {
    expect(readNumber(value)).toBe(expected);
  });

  it.each<[string | null, string | null, boolean]>([
    [null, null, true], [null, 'a', false], ['a', null, false], ['Done', 'done', true], ['Done', 'Doing', false],
  ])('sameValue(%j, %j) is %j', (a, b, expected) => {
    expect(sameValue(a, b)).toBe(expected);
  });

  it('spells a value as declared, or as given when undeclared', () => {
    expect(declaredSpelling(['Open', 'In Progress'], 'in progress')).toBe('In Progress');
    expect(declaredSpelling(['Open'], 'Later')).toBe('Later');
    expect(declaredSpelling([], 'x')).toBe('x');
  });
});

describe('links', () => {
  it.each([
    [' [[Folder/Note#Heading|Alias]] ', 'Folder/Note'], ['Bare name', 'Bare name'], ['[[Note #H|A]]', 'Note'], ['Note | alias', 'Note'],
    ['see [[Note]]', 'see [[Note]]'], ['[[Note]] x', '[[Note]] x'], ['[[]]', '[[]]'],
  ])('linkpathFromRawValue(%j) is %j', (raw, expected) => {
    expect(linkpathFromRawValue(raw)).toBe(expected);
  });
});

describe('tags', () => {
  it.each<[unknown, string[]]>([
    ['a, b #c', ['a', 'b', 'c']], ['a#b', ['a#b']], ['##x', ['x']], [',a', ['a']], [' a ,, b ', ['a', 'b']], [['#a, b', 'A c', 3], ['a', 'b', 'c']],
    [null, []], [42, []],
  ])('readTags(%j) is %j', (value, expected) => {
    expect(readTags(value)).toStrictEqual(expected);
  });

  it.each([
    ['!!a', 'a'], ['a!!', 'a'], [' #needs review! ', 'needs-review'], ['a1!b', 'a1-b'], ['a!1b', 'a-1b'], ['é!x', 'é-x'],
    ['x!́', 'x-́'], ['a_b/c', 'a_b/c'], ['a//b', 'a/b'], ['/a/', 'a'], ['//a//', 'a'], ['-a-', '-a-'], ['2026', ''], ['2026-07', '2026-07'], ['', ''],
  ])('normalizeTag(%j) is %j', (input, expected) => {
    expect(normalizeTag(input)).toBe(expected);
  });

  it('compares tags case-insensitively and keeps typed tags Obsidian reads', () => {
    expect(hasTag(['Foo'], 'foo')).toBe(true);
    expect(hasTag(['Foo'], 'bar')).toBe(false);
    expect(hasTag([], 'x')).toBe(false);
    expect(typedTags(['#Sprint-12!, sprint-12 2026-07', '2026 ##x//y/ release--candidate'])).toStrictEqual(['Sprint-12', '2026-07', 'x/y', 'release--candidate']);
    expect(typedTags(['!!', '42', 'a', 'A'])).toStrictEqual(['a']);
  });
});

describe('placements', () => {
  it.each<[unknown, { value: string | null; invalid: boolean }]>([
    [null, absent], [undefined, absent], ['Now', { value: 'Now', invalid: false }], [' Next ', { value: 'Next', invalid: false }], ['', absent], ['  ', absent],
    [[], absent], [['Now', 'Later'], { value: 'Now', invalid: false }], [5, { value: '5', invalid: false }], [{}, invalid], [[{}], invalid], [[''], invalid],
  ])('readPlacement(%j) is %j', (value, expected) => {
    expect(readPlacement(value)).toStrictEqual(expected);
  });
});

describe('civil dates', () => {
  it.each<[unknown, { value: CivilDate | null; invalid: boolean }]>([
    [null, absent], [undefined, absent], [[], absent], ['', absent], ['  ', absent],
    [['2026-01-02', 'x'], valid(2026, 1, 2)], [[5], invalid], [' 2026-01-02 ', valid(2026, 1, 2)], ['2026-2-3 10:00', valid(2026, 2, 3)],
    ['2026-01-02T10:00', valid(2026, 1, 2)], ['2026-01-02t1', valid(2026, 1, 2)], ['on 2026-01-02', invalid], ['2026-01-02x', invalid], ['soon', invalid],
    ['12026-01-01', invalid], ['2026-001-01', invalid], ['2026-01-001', invalid], ['26-01-01', invalid], [20261001, invalid], [{}, invalid],
    ['2026-13-01', invalid], ['2026-00-10', invalid], ['2026-01-00', invalid], ['2026-01-31', valid(2026, 1, 31)], ['2026-01-32', invalid],
    ['2026-12-31', valid(2026, 12, 31)], ['2026-04-31', invalid], ['2024-02-29', valid(2024, 2, 29)], ['2026-02-29', invalid], ['2026-02-30', invalid],
    ['0000-02-29', valid(0, 2, 29)], ['0004-02-29', valid(4, 2, 29)], ['0100-02-29', invalid], ['0099-12-31', valid(99, 12, 31)],
  ])('readDate(%j) is %j', (value, expected) => {
    expect(readDate(value)).toStrictEqual(expected);
  });

  it.each<[unknown, { value: CivilDate | null; invalid: boolean }]>([
    [[], invalid], [['2026-01-01'], invalid], ['', invalid], ['  ', invalid], [null, absent], [undefined, absent], ['2026-01-01', valid(2026, 1, 1)], [5, invalid],
  ])('readSoleDate(%j) is %j', (value, expected) => {
    expect(readSoleDate(value)).toStrictEqual(expected);
  });

  it.each<[CivilDate, CivilDate, number]>([
    [civil(2026, 1, 1), civil(2026, 3, 1), 59], [civil(2026, 3, 1), civil(2026, 1, 1), -59], [civil(2024, 2, 28), civil(2024, 3, 1), 2],
    [civil(2026, 3, 28), civil(2026, 3, 30), 2], [civil(0, 1, 1), civil(1, 1, 1), 366], [civil(99, 12, 31), civil(100, 1, 1), 1],
  ])('daysBetween(%j, %j) is %i', (a, b, expected) => {
    expect(daysBetween(a, b)).toBe(expected);
  });

  it.each<[CivilDate, number, CivilDate]>([
    [civil(2026, 12, 31), 1, civil(2027, 1, 1)], [civil(2024, 2, 28), 1, civil(2024, 2, 29)], [civil(2026, 3, 1), -1, civil(2026, 2, 28)],
    [civil(2026, 1, 15), 0, civil(2026, 1, 15)], [civil(50, 1, 1), 1, civil(50, 1, 2)], [civil(0, 2, 28), 1, civil(0, 2, 29)], [civil(100, 1, 1), -1, civil(99, 12, 31)],
  ])('addDays(%j, %i) is %j', (date, days, expected) => {
    expect(addDays(date, days)).toStrictEqual(expected);
  });

  it('formats dates with four-digit years and two-digit months and days', () => {
    expect(formatCivil(civil(5, 3, 7))).toBe('0005-03-07');
    expect(formatCivil(civil(2026, 12, 31))).toBe('2026-12-31');
    expect(formatCivil(addDays(civil(50, 1, 1), 1))).toBe('0050-01-02');
  });

  it.each<[CivilDate | null, CivilDate | null, boolean]>([
    [null, civil(2026, 1, 1), false], [civil(2026, 1, 1), null, false], [null, null, false], [civil(2026, 1, 1), civil(2026, 1, 1), false],
    [civil(2026, 1, 2), civil(2026, 1, 1), true], [civil(2026, 1, 1), civil(2026, 1, 2), false],
  ])('reversedSpan(%j, %j) is %j', (start, target, expected) => {
    expect(reversedSpan(start, target)).toBe(expected);
  });

  it.each<[CivilDate, CivilDate | null, boolean]>([
    [civil(2026, 1, 1), civil(2026, 1, 1), true], [civil(2026, 1, 1), civil(2027, 1, 1), false], [civil(2026, 1, 1), civil(2026, 2, 1), false],
    [civil(2026, 1, 1), civil(2026, 1, 2), false], [civil(2026, 1, 1), null, false],
  ])('sameCivil(%j, %j) is %j', (a, b, expected) => {
    expect(sameCivil(a, b)).toBe(expected);
  });
});
