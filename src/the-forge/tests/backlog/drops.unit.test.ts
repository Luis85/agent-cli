import { describe, expect, it } from 'vitest';
import { dropPlacement, unchangedPlacement, type Ranked } from '../../src/plugins/backlog/domain/ranks.ts';

// Acceptance examples from backlog-view's test/domain/rankedPlacement.test.ts and dropTargetFor.
interface Row extends Ranked { parent: Row | null; hasParentValue: boolean }
const row = (path: string, order: number | null, entryIndex: number, outsideFilter = false): Row => ({ path, order, entryIndex, outsideFilter, parent: null, hasParentValue: false });
const context = (path: string, order: number | null, entryIndex: number) => row(path, order, entryIndex, true);

describe('drop placement over the global rank', () => {
  it('ranks between the global neighbours of the anchor, not the siblings', () => {
    const a = row('a', 1000, 0), b = row('b', 2000, 1), c = row('c', 3000, 2), x = row('x', 2500, 3);
    const ranked = [a, b, x, c];
    // b's global successor is x (another branch), so "after b" lands between b and x.
    expect(dropPlacement(c, { parent: null, peers: [a, b], insertIndex: 2 }, ranked)).toStrictEqual({ order: 2250 });
    expect(dropPlacement(c, { parent: null, peers: [a, b], insertIndex: 0 }, ranked)).toStrictEqual({ order: 0 });
    expect(dropPlacement(null, { parent: null, peers: [], insertIndex: 0 }, [])).toStrictEqual({ order: 1000 });
    expect(dropPlacement(null, { parent: b, peers: [], insertIndex: 0 }, ranked)).toStrictEqual({ order: 2250 });
    expect(dropPlacement(null, { parent: null, peers: [], insertIndex: 0 }, ranked)).toStrictEqual({ order: 4000 });
    expect(dropPlacement(null, { parent: null, peers: [c], insertIndex: 1 }, ranked)).toStrictEqual({ order: 4000 });
  });

  it('leaves the dragged note out of its own neighbours', () => {
    const a = row('a', 1000, 0), b = row('b', 2000, 1), x = row('x', 2500, 2), c = row('c', 3000, 3);
    expect(dropPlacement(b, { parent: null, peers: [a], insertIndex: 1 }, [a, b, x, c])).toStrictEqual({ order: 1750 });
  });

  it('skips unranked context rows and places against ranked ones', () => {
    const a = row('a', 1000, 0), u = context('u', null, 1), k = context('k', 2000, 2), c = row('c', 3000, 3);
    expect(dropPlacement(null, { parent: null, peers: [a], insertIndex: 1 }, [a, u, c])).toStrictEqual({ order: 2000 });
    expect(dropPlacement(null, { parent: null, peers: [a], insertIndex: 1 }, [a, k, c])).toStrictEqual({ order: 1500 });
    expect(dropPlacement(null, { parent: u, peers: [], insertIndex: 0 }, [a, u, c])).toStrictEqual({ order: 4000 });
    expect(dropPlacement(null, { parent: u, peers: [], insertIndex: 0 }, [u])).toStrictEqual({ order: 1000 });
  });

  it('places beside a lone anchor, and refuses an anchor or neighbour without a rank', () => {
    const b = row('b', 2000, 0), n = row('n', null, 1), a = row('a', 1000, 2), c = row('c', 3000, 3);
    expect(dropPlacement(null, { parent: b, peers: [], insertIndex: 0 }, [])).toStrictEqual({ order: 3000 });
    expect(dropPlacement(null, { parent: n, peers: [], insertIndex: 0 }, [])).toStrictEqual({ refusal: 'unranked' });
    expect(dropPlacement(null, { parent: null, peers: [b], insertIndex: 0 }, [])).toStrictEqual({ order: 1000 });
    expect(dropPlacement(null, { parent: null, peers: [b], insertIndex: 1 }, [])).toStrictEqual({ order: 3000 });
    expect(dropPlacement(null, { parent: null, peers: [a], insertIndex: 1 }, [a, n, c])).toStrictEqual({ refusal: 'unranked' });
    expect(dropPlacement(null, { parent: null, peers: [c], insertIndex: 0 }, [a, n, c])).toStrictEqual({ refusal: 'unranked' });
    expect(dropPlacement(null, { parent: null, peers: [n], insertIndex: 1 }, [a, n, c])).toStrictEqual({ refusal: 'unranked' });
    expect(dropPlacement(null, { parent: null, peers: [n], insertIndex: 0 }, [a, n, c])).toStrictEqual({ refusal: 'unranked' });
  });

  it('refuses an anchor missing from the ranked rows', () => {
    const a = row('a', 1000, 0), stray = row('stray', 500, 1);
    expect(dropPlacement(null, { parent: null, peers: [stray], insertIndex: 1 }, [a])).toStrictEqual({ refusal: 'unranked' });
    expect(dropPlacement(null, { parent: null, peers: [row('u', null, 0)], insertIndex: 1 }, [row('u', null, 0), a])).toStrictEqual({ refusal: 'unranked' });
  });
});

describe('sibling fallback on a global tie', () => {
  it('falls back to sibling-scoped arithmetic when that rank is free, and refuses otherwise', () => {
    const p = row('p', 10, 0), q = row('q', 10, 1), r = row('r', 30, 2), s = row('s', 20, 3), t = row('t', 10, 4);
    expect(dropPlacement(s, { parent: null, peers: [p, r], insertIndex: 1 }, [p, q, s, r])).toStrictEqual({ order: 20 });
    expect(dropPlacement(null, { parent: null, peers: [p, t], insertIndex: 1 }, [p, q, t])).toStrictEqual({ refusal: 'tied' });
  });

  it('keeps the tie when the sibling rank is taken by another note', () => {
    const p = row('p', 10, 0), q = row('q', 10, 1), w = row('w', 20, 2), r = row('r', 30, 3);
    expect(dropPlacement(null, { parent: null, peers: [p, r], insertIndex: 1 }, [p, q, w, r])).toStrictEqual({ refusal: 'tied' });
  });

  it('never falls back on a spent gap', () => {
    const p = row('p', 1, 0), q = row('q', 1.000001, 1), r = row('r', 2, 2);
    expect(dropPlacement(null, { parent: null, peers: [p, r], insertIndex: 1 }, [p, q, r])).toStrictEqual({ refusal: 'gapSpent' });
  });
});

describe('unchanged placement', () => {
  it('is a no-op only under the same parent at the same rankable index', () => {
    const parent = row('P', 1, 0), other = row('O', 2, 1);
    const a = { ...row('a', 10, 2), parent }, b = { ...row('b', 20, 3), parent }, u = context('u', null, 4);
    expect(unchangedPlacement(b, { parent, peers: [a], insertIndex: 1 }, [a, b])).toBe(true);
    expect(unchangedPlacement(b, { parent, peers: [a], insertIndex: 0 }, [a, b])).toBe(false);
    expect(unchangedPlacement(b, { parent: other, peers: [], insertIndex: 0 }, [b])).toBe(false);
    expect(unchangedPlacement(b, { parent: null, peers: [], insertIndex: 0 }, [b])).toBe(false);
    expect(unchangedPlacement(a, { parent, peers: [u], insertIndex: 0 }, [u, a])).toBe(true);
    const linked = { ...b, hasParentValue: true };
    expect(unchangedPlacement(linked, { parent, peers: [a], insertIndex: 1 }, [a, linked])).toBe(true);
  });

  it('moves a root note that still holds a stale parent link', () => {
    const root = row('r', 10, 0), stale = { ...row('s', 20, 1), hasParentValue: true };
    expect(unchangedPlacement(root, { parent: null, peers: [], insertIndex: 0 }, [root])).toBe(true);
    expect(unchangedPlacement(stale, { parent: null, peers: [], insertIndex: 0 }, [stale])).toBe(false);
    expect(unchangedPlacement(root, { parent: row('P', 1, 2), peers: [], insertIndex: 0 }, [root])).toBe(false);
  });
});
