import { createItems, nearestFolderNote, type NoteSource, type RawItem } from './items.ts';
import { resolveDependencies } from './dependencies.ts';
import { compareRank } from './ranks.ts';
import type { BacklogSettings } from './settings.ts';
import {
  ALL_TYPES, EXTRA_TYPE_RANK, childLevelIndex, inCatalog, isExtraType, isIterationType, isMarkerType, isReleaseType, ladderFor,
} from './vocabulary.ts';

/** One loaded note in the hierarchy, with its level, rollups and resolved dependencies. */
export interface BacklogItem extends RawItem {
  parent: BacklogItem | null;
  children: BacklogItem[];
  /** A parent value that does not resolve to a loaded note, or a parent loop cut here. */
  orphan: boolean;
  /** This note closed a parent loop; its parent link was cut. */
  cycleCut: boolean;
  depth: number; levelIndex: number; effectiveLevelIndex: number; ladder: string[]; impliedType: boolean;
  descendantCount: number; doneDescendants: number; subtreeDone: boolean;
  prerequisites: BacklogItem[];
  brokenPrerequisites: { raw: string; reason: 'unresolved' | 'cycle' }[];
}

export interface BacklogModel {
  /** Top-level notes in sibling order. */
  roots: BacklogItem[];
  byPath: Map<string, BacklogItem>;
  /** Every item in tree preorder. */
  items: BacklogItem[];
  /** Every item by global rank: `order` ascending, ties by result order, unranked last. */
  ranked: BacklogItem[];
  /** Plan results (not context rows, iterations, releases or test-catalog items), in tree preorder. */
  results: BacklogItem[];
  iterations: BacklogItem[];
  releases: BacklogItem[];
  resources: string[];
  absences: string[];
  /** Notes `hierarchyOnly` pruned. */
  ignored: string[];
}

/** Whether an item is drawn on the plan (tree, board): not a release, an iteration or a test-catalog item. */
export function inPlan(item: { ladder: string[]; typeName: string | null }): boolean {
  return !isReleaseType(item.typeName) && !inCatalog(item) && !isIterationType(item.typeName);
}

const compareSiblings = (a: RawItem, b: RawItem) => {
  const ao = a.order ?? Number.POSITIVE_INFINITY, bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao < bo ? -1 : 1;
  return a.entryIndex - b.entryIndex;
};

/**
 * backlog-view's `buildModel` for the plan: read the results and context ancestors, link parents (folder notes
 * in folder mode), cut parent loops at the note that closes them, prune non-hierarchy roots (`hierarchyOnly`),
 * sort siblings by rank, assign levels and rollups, and resolve dependencies.
 */
export function buildModel(source: NoteSource, results: readonly string[], settings: BacklogSettings, exists: (path: string) => boolean): BacklogModel {
  const store = createItems(source, results, settings, exists);
  let all = store.all as BacklogItem[];
  const byPath = store.byPath as Map<string, BacklogItem>;
  for (const item of all) Object.assign(item, { parent: null, children: [], orphan: false, cycleCut: false, prerequisites: [], brokenPrerequisites: [] });
  const roots: BacklogItem[] = [];
  for (const item of all) {
    let parent = item.parentPath ? byPath.get(item.parentPath) : undefined;
    if (!parent && settings.folderHierarchy && !item.hasParentValue && !item.explicitRoot) {
      const folderNote = nearestFolderNote(item.path, path => byPath.has(path));
      parent = folderNote === null ? undefined : byPath.get(folderNote);
    }
    if (parent && parent !== item) { item.parent = parent; parent.children.push(item); }
    else { item.orphan = item.hasParentValue; roots.push(item); }
  }
  breakCycles(all, roots);
  const ignored: string[] = [];
  if (settings.hierarchyOnly) {
    const supported = new Set(ALL_TYPES.map(type => type.toLowerCase()));
    const belongs = (item: BacklogItem): boolean => item.parent !== null || item.hasParentValue || item.explicitRoot || item.parentExists
      || (item.typeName !== null && supported.has(item.typeName.toLowerCase()));
    const subtreeBelongs = (item: BacklogItem): boolean => belongs(item) || item.children.some(subtreeBelongs);
    for (let index = roots.length - 1; index >= 0; index--) {
      const root = roots[index]!;
      if (subtreeBelongs(root)) continue;
      roots.splice(index, 1);
      for (const stack = [root]; stack.length > 0;) {
        const current = stack.pop()!;
        ignored.push(current.path);
        byPath.delete(current.path);
        stack.push(...current.children);
      }
    }
    all = all.filter(item => byPath.has(item.path));
  }
  const sortDeep = (list: BacklogItem[]) => { list.sort(compareSiblings); for (const item of list) sortDeep(item.children); };
  sortDeep(roots);
  const items: BacklogItem[] = [];
  const assign = (item: BacklogItem, depth: number): { count: number; done: number } => {
    item.depth = depth;
    computeLevel(item);
    items.push(item);
    let count = 0, done = 0;
    for (const child of item.children) {
      const sub = assign(child, depth + 1);
      if (inCatalog(child) || inCatalog(item)) continue;
      const self = child.outsideFilter || isMarkerType(child.typeName) ? 0 : 1;
      count += self + sub.count;
      done += (child.done ? self : 0) + sub.done;
    }
    Object.assign(item, { descendantCount: count, doneDescendants: done, subtreeDone: item.done && done === count });
    return { count, done };
  };
  for (const root of roots) assign(root, 0);
  const dependencies = resolveDependencies(items);
  for (const item of items) {
    const result = dependencies.get(item.path)!;
    item.prerequisites = result.prerequisites;
    item.brokenPrerequisites = result.broken;
  }
  const inFilter = items.filter(item => !item.outsideFilter);
  return {
    roots, byPath, items, ranked: [...items].sort(compareRank),
    results: inFilter.filter(inPlan),
    iterations: inFilter.filter(item => isIterationType(item.typeName)),
    releases: inFilter.filter(item => isReleaseType(item.typeName)),
    resources: store.resources, absences: store.absences, ignored: ignored.reverse(),
  };
}

/** Every note unreachable from a root sits on a parent loop; the loop is cut at the note that closes it. */
function breakCycles(all: BacklogItem[], roots: BacklogItem[]): void {
  const visited = new Set<BacklogItem>();
  const mark = (start: BacklogItem) => {
    for (const stack = [start]; stack.length > 0;) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      stack.push(...current.children);
    }
  };
  for (const root of roots) mark(root);
  for (const unreachable of all) {
    if (visited.has(unreachable)) continue;
    const seen = new Set<BacklogItem>();
    let entry = unreachable;
    while (entry.parent && !seen.has(entry)) { seen.add(entry); entry = entry.parent; }
    if (entry.parent) {
      const siblings = entry.parent.children;
      siblings.splice(siblings.indexOf(entry), 1);
      entry.parent = null;
    }
    entry.orphan = true;
    entry.cycleCut = true;
    roots.push(entry);
    mark(entry);
  }
}

/** The item's ladder and rung: its own type's rung, an extra type's PBI rung, or the rung below its parent. */
function computeLevel(item: BacklogItem): void {
  item.ladder = ladderFor(item.typeName, item.parent?.ladder ?? null);
  const childSlot = childLevelIndex(item.parent, item.ladder);
  if (item.typeName !== null) {
    const name = item.typeName.toLowerCase();
    const index = item.ladder.findIndex(level => level.toLowerCase() === name);
    item.levelIndex = index;
    item.effectiveLevelIndex = index >= 0 ? index : isExtraType(item.typeName) ? EXTRA_TYPE_RANK : childSlot;
    item.impliedType = false;
  } else {
    item.levelIndex = item.effectiveLevelIndex = childSlot;
    item.impliedType = true;
  }
}

/** The type a row shows: its ladder rung, or its own unknown type name. */
export function displayType(item: Pick<BacklogItem, 'levelIndex' | 'ladder' | 'typeName'>): string {
  return item.levelIndex >= 0 ? item.ladder[item.levelIndex]! : item.typeName ?? '';
}

