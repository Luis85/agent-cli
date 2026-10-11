/** The file name a link names: its last path segment, lowercased, without a Markdown `.md` extension. */
function linkName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

/** Characters fold into this many counters for the cheap lower bound of `distance`. */
const histogramSize = 32;

/** Character counts folded by code unit; equal names have equal histograms. */
function histogram(name: string): Uint8Array {
  const counts = new Uint8Array(histogramSize);
  for (let index = 0; index < name.length; index++) {
    const slot = name.charCodeAt(index) % histogramSize;
    if (counts[slot]! < 255) counts[slot]!++;
  }
  return counts;
}

/**
 * A lower bound of `distance`: an insertion or deletion changes one character count by one, a substitution two
 * counts by one each and a swap none, so at least half the summed count difference of edits is needed. Folding
 * characters into shared counters (and capping them) only lowers the difference, so the bound stays valid.
 */
function histogramBound(a: Uint8Array, b: Uint8Array): number {
  let difference = 0;
  for (let slot = 0; slot < histogramSize; slot++) difference += Math.abs(a[slot]! - b[slot]!);
  return Math.ceil(difference / 2);
}

/**
 * Edit distance counting insertions, deletions, substitutions and swaps of adjacent characters (optimal string
 * alignment), or `limit + 1` as soon as it must exceed `limit`. `rows` are three reusable rows of at least
 * `b.length + 1` cells.
 */
function distance(a: string, b: string, limit: number, rows: [Int32Array, Int32Array, Int32Array]): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let [before, previous, current] = rows;
  for (let j = 0; j <= b.length; j++) previous[j] = j;
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let cost = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cost = Math.min(cost, before[j - 2]! + 1);
      current[j] = cost;
      if (cost < best) best = cost;
    }
    if (best > limit) return limit + 1;
    [before, previous, current] = [previous, current, before];
  }
  return previous[b.length]!;
}

/** A distinct file name with the path that represents it: the shallowest, then the first in vault path order. */
interface Candidate { name: string; histogram: Uint8Array; path: string; depth: number; order: number }

/**
 * Closest-file suggestions over vault paths. Each distinct file name is indexed once: an existing name is the answer
 * at distance zero, and otherwise a lookup only compares names whose length is within the edit limit, skips names
 * whose character counts already differ by more than the best score so far allows and stops each comparison past
 * that score; results equal comparing every path.
 */
export class ClosestFiles {
  private readonly names = new Map<string, Candidate>();
  private readonly byLength = new Map<number, Candidate[]>();
  private rows: [Int32Array, Int32Array, Int32Array] = [new Int32Array(1), new Int32Array(1), new Int32Array(1)];

  constructor(paths: readonly string[]) {
    const names = this.names;
    paths.forEach((path, order) => {
      const name = linkName(path), depth = path.split('/').length, known = names.get(name);
      if (known === undefined) names.set(name, { name, histogram: histogram(name), path, depth, order });
      else if (depth < known.depth) Object.assign(known, { path, depth, order });
    });
    for (const candidate of names.values()) {
      const group = this.byLength.get(candidate.name.length);
      if (group) group.push(candidate); else this.byLength.set(candidate.name.length, [candidate]);
    }
  }

  /**
   * The vault file whose name is closest to a missing link path, by edit distance between file names ignoring case
   * and `.md`; ties prefer fewer path segments, then vault path order. Undefined when no name is within a third of
   * the link name's length (at least one edit).
   */
  closest(linkpath: string): string | undefined {
    const wanted = linkName(linkpath);
    if (wanted.length === 0) return undefined;
    const exact = this.names.get(wanted);
    if (exact !== undefined) return exact.path;
    const limit = Math.max(1, Math.floor(wanted.length / 3)), counts = histogram(wanted);
    let best: { score: number; candidate: Candidate } | undefined;
    for (let length = Math.max(0, wanted.length - limit); length <= wanted.length + limit; length++) {
      for (const candidate of this.byLength.get(length) ?? []) {
        // Only a score up to the best one so far can still win (an equal score by depth or order).
        const bound = best?.score ?? limit;
        if (histogramBound(counts, candidate.histogram) > bound) continue;
        const score = distance(wanted, candidate.name, bound, this.workspace(candidate.name.length));
        if (score > bound) continue;
        if (!best || score < best.score || (score === best.score && (candidate.depth < best.candidate.depth
          || (candidate.depth === best.candidate.depth && candidate.order < best.candidate.order)))) best = { score, candidate };
      }
    }
    return best?.candidate.path;
  }

  private workspace(length: number): [Int32Array, Int32Array, Int32Array] {
    if (this.rows[0].length <= length) this.rows = [new Int32Array(length + 1), new Int32Array(length + 1), new Int32Array(length + 1)];
    return this.rows;
  }
}
