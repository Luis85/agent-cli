import { describe, expect, it } from 'vitest';
import {
  ORDER_SPACING, compareRank, distinctlyRanked, dropPlacement, edgeRank, placeRun, rankBetween, rankablePeers, roundOrder, spreadAround, type Ranked,
} from '../../src/plugins/backlog/domain/ranks.ts';

// Acceptance examples from backlog-view's rankArithmetic.ts and test/domain/rankedPlacement.test.ts.
const row = (path: string, order: number | null, entryIndex: number, outsideFilter = false): Ranked => ({ path, order, entryIndex, outsideFilter });

describe('rank arithmetic', () => {
  it('places between neighbours at the midpoint rounded to 6 decimals and at the edges 1000 beyond the floor', () => {
    expect(ORDER_SPACING).toBe(1000);
    expect(rankBetween(null, null)).toEqual({ order: 1000 });
    expect(rankBetween(1000, 2000)).toEqual({ order: 1500 });
    expect(rankBetween(1, 2)).toEqual({ order: 1.5 });
    expect(rankBetween(0.1, 0.2)).toEqual({ order: 0.15 });
    expect(rankBetween(1, 1.0000015)).toEqual({ order: 1.000001 });
    expect(rankBetween(null, 2500.7)).toEqual({ order: 1500 });
    expect(rankBetween(4.0625, null)).toEqual({ order: 1004 });
    expect(rankBetween(-3.5156, null)).toEqual({ order: 996 });
    expect(edgeRank(-3.5156, 'before')).toEqual({ order: -1004 });
    expect(roundOrder(7.0312500001)).toBe(7.03125);
  });

  it('refuses a tie and a spent gap', () => {
    expect(rankBetween(10, 10)).toEqual({ refusal: 'tied' });
    expect(rankBetween(1, 1.0000001)).toEqual({ refusal: 'gapSpent' });
    expect(edgeRank(Number.MAX_VALUE, 'after')).toEqual({ refusal: 'gapSpent' });
  });

  it('spreads runs evenly between fixed context ranks and refuses runs that no longer fit', () => {
    expect(placeRun(3, null, null)).toEqual([1000, 2000, 3000]);
    expect(placeRun(3, 0, 4)).toEqual([1, 2, 3]);
    expect(placeRun(2, null, 500)).toEqual([-1500, -500]);
    expect(placeRun(2, 1, 1.000001)).toBeNull();
    expect(placeRun(0, 5, 6)).toEqual([]);
    const sequence = [row('a', 7, 0), row('ctx', 2500, 1, true), row('b', null, 2), row('c', 1, 3)];
    // The run before the first context rank ends 1000 below it; the run after it continues 1000 apart.
    expect(spreadAround(sequence)).toEqual({ writes: [{ item: sequence[0], order: 1500 }, { item: sequence[2], order: 3500 }, { item: sequence[3], order: 4500 }] });
    expect(spreadAround([row('ctx', 1, 0, true), row('a', 1, 1), row('ctx2', 3, 2, true)])).toEqual({ writes: [{ item: expect.objectContaining({ path: 'a' }), order: 2 }] });
    const wedged = [row('ctx', 1, 0, true), row('a', 5, 1), row('b', 6, 2), row('ctx2', 1.000001, 3, true)];
    expect(spreadAround(wedged)).toEqual({ wedged: [wedged[1], wedged[2]] });
  });

  it('orders by rank, then result order, unranked last', () => {
    const rows = [row('c', null, 0), row('b', 5, 2), row('a', 5, 1), row('d', -1, 3)];
    expect([...rows].sort(compareRank).map(item => item.path)).toEqual(['d', 'a', 'b', 'c']);
    expect(distinctlyRanked([row('a', 1, 0), row('b', 2, 1), row('ctx', null, 2, true)])).toBe(true);
    expect(distinctlyRanked([row('a', 1, 0), row('b', 1, 1)])).toBe(false);
    expect(rankablePeers([row('a', 1, 0), row('ctx', null, 1, true), row('ctx2', 3, 2, true)]).map(item => item.path)).toEqual(['a', 'ctx2']);
  });
});

describe('drop placement over the global rank', () => {
  const a = row('a', 1000, 0), b = row('b', 2000, 1), c = row('c', 3000, 2), x = row('x', 2500, 3);
  const ranked = [a, b, x, c];
  it('ranks between the global neighbours of the anchor, not the siblings', () => {
    // b's global successor is x (another branch), so "after b" lands between b and x.
    expect(dropPlacement(c, { parent: null, peers: [a, b], insertIndex: 2 }, ranked)).toEqual({ order: 2250 });
    expect(dropPlacement(c, { parent: null, peers: [a, b], insertIndex: 0 }, ranked)).toEqual({ order: 0 });
    expect(dropPlacement(null, { parent: null, peers: [], insertIndex: 0 }, [])).toEqual({ order: 1000 });
    expect(dropPlacement(null, { parent: b, peers: [], insertIndex: 0 }, ranked)).toEqual({ order: 2250 });
  });

  it('falls back to sibling-scoped arithmetic on a global tie when that rank is free, and refuses otherwise', () => {
    const p = row('p', 10, 0), q = row('q', 10, 1), r = row('r', 30, 2), s = row('s', 20, 3);
    expect(dropPlacement(s, { parent: null, peers: [p, r], insertIndex: 1 }, [p, q, s, r])).toEqual({ order: 20 });
    const t = row('t', 10, 4);
    expect(dropPlacement(null, { parent: null, peers: [p, t], insertIndex: 1 }, [p, q, t])).toEqual({ refusal: 'tied' });
    expect(dropPlacement(null, { parent: null, peers: [row('u', null, 0)], insertIndex: 1 }, [row('u', null, 0), a])).toEqual({ refusal: 'unranked' });
  });
});
