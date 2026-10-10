/** The file name a link names: its last path segment, lowercased, without a Markdown `.md` extension. */
function linkName(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

/**
 * Edit distance counting insertions, deletions, substitutions and swaps of adjacent characters (optimal string
 * alignment), or `limit + 1` as soon as it must exceed `limit`.
 */
function distance(a: string, b: string, limit: number): number {
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
}

/**
 * The vault file whose name is closest to a missing link path, by edit distance between file names ignoring case
 * and `.md`; ties prefer fewer path segments, then vault path order. Undefined when no name is within a third of the
 * link name's length (at least one edit).
 */
export function closestFile(linkpath: string, paths: readonly string[]): string | undefined {
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
