/**
 * backlog-view's global rank (`rankArithmetic.ts`, `rankSpread.ts`, `rankOrder.ts` and the placement half of
 * `writePlan.ts`). `order` is one rank across everything the base returns; ties follow result order and unranked
 * items sort last. Context rows are never rewritten.
 */
export const ORDER_SPACING = 1000;

export interface Ranked { path: string; order: number | null; entryIndex: number; outsideFilter: boolean }
export type RankRefusal = 'gapSpent' | 'tied' | 'unranked';
export type RankResult = { order: number } | { refusal: RankRefusal };

export function compareRank(a: Ranked, b: Ranked): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY, bo = b.order ?? Number.POSITIVE_INFINITY;
  return ao - bo || a.entryIndex - b.entryIndex;
}

/** A midpoint rounded to 6 decimals. */
export function roundOrder(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Number.isFinite(rounded) ? rounded : value;
}

/** An edge position: `floor(neighbour) ± 1000`, refused when it does not clear the neighbour. */
export function edgeRank(neighbour: number, side: 'before' | 'after'): RankResult {
  const order = Math.floor(neighbour) + (side === 'after' ? ORDER_SPACING : -ORDER_SPACING);
  const clear = side === 'after' ? order > neighbour : order < neighbour;
  return clear ? { order } : { refusal: 'gapSpent' };
}

/** The rank between two neighbours; a tie or a spent gap is refused. */
export function rankBetween(prev: number | null, next: number | null): RankResult {
  if (prev === null) return next === null ? { order: ORDER_SPACING } : edgeRank(next, 'before');
  if (next === null) return edgeRank(prev, 'after');
  if (prev === next) return { refusal: 'tied' };
  const mid = roundOrder(Number.isFinite(next - prev) ? prev + (next - prev) / 2 : prev / 2 + next / 2);
  return mid > prev && mid < next ? { order: mid } : { refusal: 'gapSpent' };
}

/** `count` evenly spaced ranks strictly between `floor` and `ceiling` (1000 apart when either is open); null when they do not fit. */
export function placeRun(count: number, floor: number | null, ceiling: number | null): number[] | null {
  if (count === 0) return [];
  const step = floor !== null && ceiling !== null ? (ceiling - floor) / (count + 1) : ORDER_SPACING;
  const base = floor ?? (ceiling === null ? 0 : ceiling - (count + 1) * ORDER_SPACING);
  const wide = floor !== null && ceiling !== null && !Number.isFinite(ceiling - floor);
  const spread = (k: number) => {
    if (!wide || floor === null || ceiling === null) return base + step * (k + 1);
    const weight = (k + 1) / (count + 1);
    return floor * (1 - weight) + ceiling * weight;
  };
  const placed = Array.from({ length: count }, (_, k) => roundOrder(spread(k)));
  let previous = floor;
  for (const order of placed) {
    if (previous !== null && order <= previous) return null;
    previous = order;
  }
  return ceiling !== null && placed[count - 1]! >= ceiling ? null : placed;
}

/**
 * Renumbers `sequence` 1000 apart around the ranks of the context rows in it, which stay fixed. Returns the new
 * rank per result path, or the run of results that no longer fits between two context rows.
 */
export function spreadAround<T extends Ranked>(sequence: readonly T[]): { writes: Array<{ item: T; order: number }> } | { wedged: T[] } {
  const fixed = sequence.filter(item => item.outsideFilter && item.order !== null).map(item => item.order!).sort((a, b) => a - b);
  let at = 0;
  const above = (floor: number | null) => {
    while (at < fixed.length && floor !== null && fixed[at]! <= floor) at++;
    return fixed[at] ?? null;
  };
  const writes: Array<{ item: T; order: number }> = [];
  let run: T[] = [];
  let floor: number | null = null;
  const flush = () => {
    const placed = placeRun(run.length, floor, above(floor));
    if (placed === null) return false;
    run.forEach((item, k) => writes.push({ item, order: placed[k]! }));
    run = [];
    return true;
  };
  for (const item of sequence) {
    if (!item.outsideFilter) { run.push(item); continue; }
    if (item.order === null || (floor !== null && item.order <= floor)) continue;
    if (!flush()) return { wedged: run };
    floor = item.order;
  }
  return flush() ? { writes } : { wedged: run };
}

const isUnrankedContext = (anchor: Ranked | null) => anchor !== null && anchor.outsideFilter && anchor.order === null;
/** Peers a drop can be placed among: unranked context rows hold no rank to place against. */
export const rankablePeers = <T extends Ranked>(rows: readonly T[]) => rows.filter(row => !isUnrankedContext(row));

/** Where a note lands: its new parent, its peers there (without the moved note) and the index among them. */
export interface DropTarget<T extends Ranked> { parent: T | null; peers: T[]; insertIndex: number }

function anchoredOrder<T extends Ranked>(ranked: readonly T[], anchor: T | null, side: 'before' | 'after'): RankResult {
  const usable = ranked.filter(item => !(item.outsideFilter && item.order === null));
  if (isUnrankedContext(anchor)) return anchoredOrder(usable, null, 'after');
  if (usable.length === 0) {
    if (anchor === null) return { order: ORDER_SPACING };
    if (anchor.order === null) return { refusal: 'unranked' };
    return edgeRank(anchor.order, side);
  }
  let prev: T | null, next: T | null;
  if (anchor === null) [prev, next] = side === 'after' ? [usable.at(-1)!, null] : [null, usable[0]!];
  else {
    const index = usable.indexOf(anchor);
    if (index === -1) return { refusal: 'unranked' };
    [prev, next] = side === 'before' ? [usable[index - 1] ?? null, anchor] : [anchor, usable[index + 1] ?? null];
  }
  if ((prev !== null && prev.order === null) || (next !== null && next.order === null)) return { refusal: 'unranked' };
  return rankBetween(prev?.order ?? null, next?.order ?? null);
}

function orderForTarget<T extends Ranked>(ranked: readonly T[], target: DropTarget<T>): RankResult {
  const { peers, insertIndex, parent } = target;
  if (peers.length === 0) return anchoredOrder(ranked, parent, 'after');
  if (insertIndex === 0) return anchoredOrder(ranked, peers[0]!, 'before');
  return anchoredOrder(ranked, peers[insertIndex - 1]!, 'after');
}

/**
 * backlog-view's `dropPlacement`: the global rank between the neighbours a placement implies. On a global tie it
 * falls back to sibling-scoped arithmetic when that rank is free. The plugin's `unseededList` guard belongs to its
 * focus-mode ranking, which never changes the parent; Forge has no focus mode, so the guard is not ported.
 */
export function dropPlacement<T extends Ranked>(dragged: T | null, target: DropTarget<T>, ranked: readonly T[]): RankResult {
  const global = orderForTarget(ranked.filter(item => item !== dragged), target);
  if (!('refusal' in global) || global.refusal !== 'tied') return global;
  const scoped = orderForTarget(target.peers.filter(item => item !== dragged), target);
  if ('refusal' in scoped || !ranked.some(item => item !== dragged && item.order === scoped.order)) return scoped;
  return global;
}

/**
 * backlog-view's no-op test (`dropTargetFor`): a placement that keeps the parent and lands the item where it
 * already is among its rankable siblings changes nothing, unless it clears a stale parent link.
 */
export function unchangedPlacement<T extends Ranked & { parent: T | null; hasParentValue: boolean }>(dragged: T, target: DropTarget<T>, siblings: readonly T[]): boolean {
  if (target.parent !== dragged.parent) return false;
  if (target.parent === null && dragged.parent === null && dragged.hasParentValue) return false;
  return rankablePeers(siblings).indexOf(dragged) === target.insertIndex;
}
