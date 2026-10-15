import { describe, expect, it } from 'vitest';
import {
  ORDER_SPACING, compareRank, edgeRank, placeRun, rankBetween, rankablePeers, roundOrder, spreadAround, type Ranked,
} from '../../src/plugins/backlog/domain/ranks.ts';

// Acceptance examples from backlog-view's rankArithmetic.ts and rankSpread.ts.
const row = (path: string, order: number | null, entryIndex: number, outsideFilter = false): Ranked => ({ path, order, entryIndex, outsideFilter });
const MAX = Number.MAX_VALUE;

describe('rank arithmetic', () => {
  it('places between neighbours at the midpoint rounded to 6 decimals and at the edges 1000 beyond the floor', () => {
    expect(ORDER_SPACING).toBe(1000);
    expect(rankBetween(null, null)).toStrictEqual({ order: 1000 });
    expect(rankBetween(1000, 2000)).toStrictEqual({ order: 1500 });
    expect(rankBetween(1, 2)).toStrictEqual({ order: 1.5 });
    expect(rankBetween(0.1, 0.2)).toStrictEqual({ order: 0.15 });
    expect(rankBetween(1, 1.0000015)).toStrictEqual({ order: 1.000001 });
    expect(rankBetween(-30, -10)).toStrictEqual({ order: -20 });
    expect(rankBetween(null, 2500.7)).toStrictEqual({ order: 1500 });
    expect(rankBetween(4.0625, null)).toStrictEqual({ order: 1004 });
    expect(rankBetween(-3.5156, null)).toStrictEqual({ order: 996 });
    expect(roundOrder(7.0312500001)).toBe(7.03125);
    expect(roundOrder(MAX)).toBe(MAX);
  });

  it.each<[number, 'before' | 'after', object]>([
    [1000, 'after', { order: 2000 }], [1000, 'before', { order: 0 }], [4.5, 'after', { order: 1004 }], [4.5, 'before', { order: -996 }],
    [-3.5156, 'before', { order: -1004 }], [MAX, 'after', { refusal: 'gapSpent' }], [-MAX, 'before', { refusal: 'gapSpent' }],
  ])('edgeRank(%d, %s) is %j', (neighbour, side, expected) => {
    expect(edgeRank(neighbour, side)).toStrictEqual(expected);
  });

  it('refuses a tie and a spent gap, also when the midpoint rounds onto a neighbour', () => {
    expect(rankBetween(10, 10)).toStrictEqual({ refusal: 'tied' });
    expect(rankBetween(1, 1.0000001)).toStrictEqual({ refusal: 'gapSpent' });
    expect(rankBetween(1.0000004, 1.000001)).toStrictEqual({ refusal: 'gapSpent' });
    expect(rankBetween(null, -MAX)).toStrictEqual({ refusal: 'gapSpent' });
  });

  it('halves each neighbour when their distance overflows', () => {
    expect(rankBetween(-MAX, MAX)).toStrictEqual({ order: 0 });
  });

  it('orders by rank, then result order, unranked last', () => {
    const rows = [row('c', null, 0), row('b', 5, 2), row('a', 5, 1), row('d', -1, 3), row('e', null, -1)];
    expect([...rows].sort(compareRank).map(item => item.path)).toStrictEqual(['d', 'a', 'b', 'e', 'c']);
    expect(rankablePeers([row('a', 1, 0), row('ctx', null, 1, true), row('ctx2', 3, 2, true), row('u', null, 3)]).map(item => item.path)).toStrictEqual(['a', 'ctx2', 'u']);
  });
});

describe('placing runs', () => {
  it.each<[number, number | null, number | null, number[] | null]>([
    [3, null, null, [1000, 2000, 3000]], [1, null, null, [1000]], [3, 0, 4, [1, 2, 3]], [2, null, 500, [-1500, -500]], [2, 500, null, [1500, 2500]],
    [0, 5, 6, []], [2, 1, 1.000001, null], [1, 1, 1.000001, null], [2, 1, 1.0000015, null], [1, MAX, null, null],
  ])('placeRun(%i, %d, %d) is %j', (count, floor, ceiling, expected) => {
    expect(placeRun(count, floor, ceiling)).toStrictEqual(expected);
  });

  it('steps evenly from the floor of a finite span, rounding thirds of a large rank to 6 decimals', () => {
    expect(placeRun(2, 832677219, 832677220)).toStrictEqual([832677219.333333, 832677219.666667]);
  });

  it('interpolates a run between bounds whose distance overflows', () => {
    expect(placeRun(1, -MAX, MAX)).toStrictEqual([0]);
    const run = placeRun(3, -MAX, MAX)!;
    expect(run).toHaveLength(3);
    expect(run[0]! / MAX).toBeCloseTo(-0.5, 12);
    expect(run[1]).toBe(0);
    expect(run[2]! / MAX).toBeCloseTo(0.5, 12);
  });
});

describe('spreading around context rows', () => {
  it('spreads runs evenly between fixed context ranks and refuses runs that no longer fit', () => {
    const sequence = [row('a', 7, 0), row('ctx', 2500, 1, true), row('b', null, 2), row('c', 1, 3)];
    // The run before the first context rank ends 1000 below it; the run after it continues 1000 apart.
    expect(spreadAround(sequence)).toStrictEqual({ writes: [{ item: sequence[0], order: 1500 }, { item: sequence[2], order: 3500 }, { item: sequence[3], order: 4500 }] });
    const between = [row('ctx', 1, 0, true), row('a', 1, 1), row('ctx2', 3, 2, true)];
    expect(spreadAround(between)).toStrictEqual({ writes: [{ item: between[1], order: 2 }] });
    const wedged = [row('ctx', 1, 0, true), row('a', 5, 1), row('b', 6, 2), row('ctx2', 1.000001, 3, true)];
    expect(spreadAround(wedged)).toStrictEqual({ wedged: [wedged[1], wedged[2]] });
  });

  it('takes ceilings from the context ranks in rank order', () => {
    const sequence = [row('a', 1, 0), row('ctx5', 5, 1, true), row('b', 2, 2), row('ctx3', 3, 3, true), row('ctx10', 10, 4, true)];
    expect(spreadAround(sequence)).toStrictEqual({ writes: [{ item: sequence[0], order: -997 }, { item: sequence[2], order: 7.5 }] });
  });

  it.each<[string, Ranked[], number[]]>([
    ['an unranked context row before the run', [row('ctx', null, 0, true), row('a', 1, 1), row('ctx10', 10, 2, true)], [-990]],
    ['a negative context rank', [row('a', 1, 0), row('ctx', -5, 1, true)], [-1005]],
    ['a negative leading context rank', [row('ctx', -5, 0, true), row('a', 1, 1)], [995]],
    ['an unranked context row above a negative floor', [row('ctx', -5, 0, true), row('a', 1, 1), row('u', null, 2, true), row('b', 2, 3)], [995, 1995]],
    ['an unranked context row inside the run', [row('ctx', 10, 0, true), row('a', 1, 1), row('u', null, 2, true), row('b', 2, 3)], [1010, 2010]],
    ['a higher context row', [row('ctx', 1, 0, true), row('a', 9, 1), row('ctx3', 3, 2, true), row('b', 9, 3)], [2, 1003]],
    ['a tied context row', [row('ctx', 1, 0, true), row('a', 9, 1), row('ctx1', 1, 2, true), row('b', 9, 3)], [1001, 2001]],
    ['a lower context row', [row('ctx', 5, 0, true), row('a', 9, 1), row('ctx1', 1, 2, true), row('b', 9, 3)], [1005, 2005]],
  ])('places results around %s', (_, sequence, orders) => {
    const results = sequence.filter(item => !item.outsideFilter);
    expect(spreadAround(sequence)).toStrictEqual({ writes: results.map((item, k) => ({ item, order: orders[k] })) });
  });

  it('reports a last run that no longer fits', () => {
    const sequence = [row('ctx', MAX, 0, true), row('a', 1, 1)];
    expect(spreadAround(sequence)).toStrictEqual({ wedged: [sequence[1]] });
  });
});
