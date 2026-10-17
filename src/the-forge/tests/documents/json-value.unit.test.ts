import { expect, it } from 'vitest';
import { jsonValueIssue } from '../../src/domain/shared/json-value.ts';

it('accepts plain JSON data, including repeated but acyclic references', () => {
  const shared = { a: [1, 'two', true, null] };
  expect(jsonValueIssue({ left: shared, right: shared, nested: [[{ deep: Object.create(null) }]] })).toBeUndefined();
});

it('reports the first issue depth first', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let deep: unknown = 'leaf';
  for (let level = 0; level < 100; level++) deep = [deep];
  expect(jsonValueIssue(cyclic)).toBe('cycle');
  expect(jsonValueIssue(deep)).toBe('depth');
  expect(jsonValueIssue([1, Number.NaN])).toBe('number');
  for (const value of [undefined, () => 1, new Date(0), 1n, Symbol('s')]) expect(jsonValueIssue({ value })).toBe('type');
  expect(jsonValueIssue([Infinity, cyclic])).toBe('number');
});
