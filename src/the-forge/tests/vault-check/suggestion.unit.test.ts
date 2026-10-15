import { describe, expect, it } from 'vitest';
import { ClosestFiles } from '../../src/plugins/vault-check/domain/suggestion.ts';

/** The previous implementation, which compared every path for every lookup; the index must return the same paths. */
function bruteForceClosest(linkpath: string, paths: readonly string[]): string | undefined {
  const linkName = (path: string) => {
    const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    return name.endsWith('.md') ? name.slice(0, -3) : name;
  };
  const distance = (a: string, b: string, limit: number): number => {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let before: number[] = [], previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      const current = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        let cost = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cost = Math.min(cost, before[j - 2]! + 1);
        current[j] = cost;
        best = Math.min(best, cost);
      }
      if (best > limit) return limit + 1;
      before = previous;
      previous = current;
    }
    return previous[b.length]!;
  };
  const wanted = linkName(linkpath);
  if (wanted.length === 0) return undefined;
  const limit = Math.max(1, Math.floor(wanted.length / 3));
  let best: { path: string; score: number; depth: number } | undefined;
  for (const path of paths) {
    const score = distance(wanted, linkName(path), limit);
    if (score > limit) continue;
    const depth = path.split('/').length;
    if (!best || score < best.score || (score === best.score && depth < best.depth)) best = { path, score, depth };
  }
  return best?.path;
}

/** A deterministic pseudo-random sequence (linear congruential). */
function sequence(seed: number) {
  let state = seed;
  return (limit: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor((state / 2147483648) * limit);
  };
}

describe('closest file suggestions', () => {
  const paths = ['Projects/Alpha.md', 'Notes/Alpha Plan.md', 'assets/diagram.png', 'Deep/Nested/alpha.md'];
  const closest = (linkpath: string, among: readonly string[] = paths) => new ClosestFiles(among).closest(linkpath);

  it('suggests the nearest file name, ignoring case and .md, preferring shallow paths', () => {
    expect(closest('Projects/Alpah')).toBe('Projects/Alpha.md');
    expect(closest('alpha')).toBe('Projects/Alpha.md');
    expect(closest('diagramm.png')).toBe('assets/diagram.png');
    expect(closest('Alpha Plna.md')).toBe('Notes/Alpha Plan.md');
  });

  it('suggests nothing beyond a third of the name length', () => {
    expect(closest('Roadmap')).toBeUndefined();
    expect(closest('x', [])).toBeUndefined();
    expect(closest('plan', ['pxyn.md'])).toBeUndefined();
  });

  it.each([[''], ['folder/'], ['.md']])('suggests nothing for the link %j, which names no file', linkpath => {
    expect(closest(linkpath, ['x.md', 'a/.md', 'ab.md'])).toBeUndefined();
  });

  it('allows at least one edit, even for a link name of one or two characters', () => {
    expect(closest('ab', ['a.md'])).toBe('a.md');
    expect(closest('b', ['a.md'])).toBe('a.md');
  });

  it('compares long names whose characters repeat many times', () => {
    expect(closest('a'.repeat(256), [`${'a'.repeat(255)}b.md`])).toBe(`${'a'.repeat(255)}b.md`);
  });

  it('breaks ties by fewer path segments, then by vault path order', () => {
    expect(closest('plan', ['b/c/plan.md', 'a/plam.md', 'z/plan.md'])).toBe('z/plan.md');
    expect(closest('plan', ['b/plam.md', 'a/plin.md'])).toBe('b/plam.md');
    expect(closest('plan', ['x/y/plan.md', 'plam.md'])).toBe('x/y/plan.md');
    expect(closest('plan', ['a/plan.md', 'b/Plan.md', 'plam.md'])).toBe('a/plan.md');
    expect(closest('plam', ['a/plan.md', 'b/plan.md'])).toBe('a/plan.md');
    expect(closest('abcdef', ['abdcef.md', 'abcxef.md'])).toBe('abdcef.md');
  });

  it('suggests an existing file of the same name, such as the target of a broken relative link', () => {
    expect(closest('Other/Folder/ALPHA.md')).toBe('Projects/Alpha.md');
    expect(closest('../assets/diagram.png')).toBe('assets/diagram.png');
  });

  it('counts swaps of adjacent characters as one edit and compares names of other lengths', () => {
    expect(closest('ab', ['ba.md', 'abc.md'])).toBe('ba.md');
    expect(closest('plan', ['x/y/paln.md', 'pxyn.md'])).toBe('x/y/paln.md');
    expect(closest('roadmap', ['raodmap.md'])).toBe('raodmap.md');
    expect(closest('roadmap', ['roadmaps.md', 'road.md'])).toBe('roadmaps.md');
    expect(closest('Ä-Notiz', ['ä-notiz.md', 'a-notiz.md'])).toBe('ä-notiz.md');
  });

  it.each([[7, 'abcde fgh-1Ä'], [11, 'ab']])('returns exactly what comparing every path returns (seed %i, letters %j)', (seed, alphabet) => {
    const pick = sequence(seed);
    const word = (length: number) => Array.from({ length }, () => alphabet[pick(alphabet.length)]).join('');
    const vault = Array.from({ length: 400 }, () => {
      const folders = Array.from({ length: pick(3) }, () => word(1 + pick(3)));
      return [...folders, word(1 + pick(9)) + (pick(4) === 0 ? '.png' : '.md')].join('/');
    }).sort();
    const index = new ClosestFiles(vault);
    let suggested = 0;
    for (let attempt = 0; attempt < 1500; attempt++) {
      const existing = vault[pick(vault.length)]!;
      const linkpath = attempt % 5 === 0 ? `elsewhere/${existing}` : attempt % 3 === 0 ? existing.replace(/.$/, word(1)) : word(1 + pick(12));
      const expected = bruteForceClosest(linkpath, vault);
      expect(index.closest(linkpath), linkpath).toBe(expected);
      if (expected !== undefined) suggested++;
    }
    // A third of the lookups find a suggestion, so the comparison covers ranking, not only misses.
    expect(suggested).toBeGreaterThan(400);
  });
});
