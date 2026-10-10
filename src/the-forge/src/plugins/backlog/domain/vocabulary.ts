/**
 * The fixed type vocabulary of backlog-view (`domain/typeVocabulary.ts`, `domain/itemTypes.ts`). Type names match
 * case-insensitively and are written in canonical spelling. Type rules guide; they refuse nothing except the few
 * writes `mayHoldField` and `placementEnds` rule out.
 */
export const LEVELS = ['Epic', 'Feature', 'PBI', 'Task'];
export const TEST_LEVELS = ['Test suite', 'Test case', 'Task'];
const DELIVERABLE_TYPE = 'Deliverable';
const EXTRA_TYPES = ['Issue', 'Bug', 'Idea', DELIVERABLE_TYPE, 'Improvement'];
export const ITERATION_TYPE = 'Iteration';
const MILESTONE_TYPE = 'Milestone';
export const RELEASE_TYPE = 'Release';
const MARKER_TYPES = [MILESTONE_TYPE, ITERATION_TYPE, RELEASE_TYPE];
export const RESOURCE_TYPE = 'Resource';
export const ABSENCE_TYPE = 'Absence';
/** Every type the backlog knows, in vocabulary order (the order release notes group by). */
export const ALL_TYPES = [...LEVELS, ...EXTRA_TYPES, ...MARKER_TYPES, ...TEST_LEVELS.filter(type => !LEVELS.includes(type))];
export const DEFAULT_HOME_FOLDER = 'docs';
/** Types the backlog view files by `typeFolder.<type>`; releases are filed by the release view's `releaseFolder`. */
export const FILED_TYPES = ALL_TYPES.filter(type => type !== RELEASE_TYPE);
export const FOLDER_OPTION_TYPES = [...FILED_TYPES, ABSENCE_TYPE];
/** Extra types rank with the PBI rung. */
export const EXTRA_TYPE_RANK = Math.max(LEVELS.length - 2, 0);

const defaultSubfolders: Readonly<Record<string, string>> = {
  epic: 'requirements', feature: 'requirements', pbi: 'requirements', task: 'tasks', issue: 'issues', bug: 'bugs',
  idea: 'ideas', deliverable: 'deliverables', improvement: 'improvements', milestone: 'milestones',
  iteration: 'iterations', release: 'releases', 'test suite': 'tests/suites', 'test case': 'tests/cases',
};

const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();
/** Whether a type name is `type`, ignoring letter case. */
export const sameType = same;
const member = (list: readonly string[], name: string | null) => name !== null && list.some(type => same(name, type));

/** A value from a table keyed by lowercased name, never read off the prototype. */
export function byName<T>(table: Readonly<Record<string, T>>, name: string | null): T | undefined {
  if (name === null) return undefined;
  const key = name.toLowerCase();
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** The canonical spelling of a known type, or the name as given for an unknown one. */
export function canonicalType(name: string): string {
  return [...ALL_TYPES, RESOURCE_TYPE, ABSENCE_TYPE].find(type => same(name, type)) ?? name;
}

export function typeFolderKey(type: string): string { return `typeFolder.${type.toLowerCase()}`; }

export function defaultTypeFolder(type: string, homeFolder = DEFAULT_HOME_FOLDER): string {
  const sub = byName(defaultSubfolders, type);
  if (!sub) return '';
  return homeFolder ? `${homeFolder}/${sub}` : sub;
}

export function defaultResourceFolder(homeFolder = DEFAULT_HOME_FOLDER): string {
  return homeFolder ? `${homeFolder}/resources` : 'resources';
}

export const isExtraType = (type: string | null) => member(EXTRA_TYPES, type);
export const isMarkerType = (type: string | null) => member(MARKER_TYPES, type);
export const isIterationType = (type: string | null) => same(type, ITERATION_TYPE);
export const isReleaseType = (type: string | null) => same(type, RELEASE_TYPE);
export const isResourceType = (type: string | null) => same(type, RESOURCE_TYPE);
export const isAbsenceType = (type: string | null) => same(type, ABSENCE_TYPE);
export const isDeliverableType = (type: string | null) => same(type, DELIVERABLE_TYPE);

/**
 * The ladder a type climbs: the test ladder for test types, the plan ladder otherwise. `Task` is on both and
 * follows its parent; an untyped note follows its parent too.
 */
export function ladderFor(type: string | null, parentLadder: string[] | null): string[] {
  if (type === null) return parentLadder ?? LEVELS;
  const onTest = member(TEST_LEVELS, type), onPlan = member(LEVELS, type);
  if (onTest && onPlan) return parentLadder ?? LEVELS;
  return onTest ? TEST_LEVELS : LEVELS;
}

export const inCatalog = (item: { ladder: string[] }) => item.ladder === TEST_LEVELS;

/** Whether `item` under `parent` stays on its own projection (a test item cannot move under plan work). */
export function keepsProjection(item: { typeName: string | null; ladder: string[] }, parent: { ladder: string[] } | null): boolean {
  return ladderFor(item.typeName, parent?.ladder ?? null) === item.ladder;
}

export interface LadderPosition { levelIndex: number; effectiveLevelIndex: number; ladder: string[]; typeName: string | null }

/** The rung a child of `parent` takes; the deepest rung is clamped. */
export function childLevelIndex(parent: LadderPosition | null, ladder: string[] = parent?.ladder ?? LEVELS): number {
  if (!parent) return 0;
  return Math.min(parent.effectiveLevelIndex + 1, ladder.length - 1);
}

export type PlacementEnd = 'start' | 'target';

/** A marker other than a release reduces to its target date, an iteration too unless it draws as a bar. */
export function drawsAsPoint(type: string | null, iterationBars: boolean): boolean {
  if (!isMarkerType(type) || isReleaseType(type)) return false;
  return isIterationType(type) ? !iterationBars : true;
}

/** The planned dates a type may hold. A release holds none on the planning axis. */
export function placementEnds(type: string | null, iterationBars: boolean): PlacementEnd[] {
  if (isReleaseType(type)) return [];
  return drawsAsPoint(type, iterationBars) ? ['target'] : ['start', 'target'];
}

/** The optional fields a type-aware write checks. */
export type HeldField = 'release' | 'start' | 'target' | 'horizon' | 'iteration' | 'iterationGoal';

/**
 * backlog-view's `mayHoldField`: a release link is refused on markers and test-ladder items; a Release may not
 * hold horizon, iteration or goal, and holds only the dates `placementEnds` allows.
 */
export function mayHoldField(type: string | null, field: HeldField, iterationBars: boolean): boolean {
  if (field === 'release') return !isMarkerType(type) && ladderFor(type, null) !== TEST_LEVELS;
  if (!isReleaseType(type)) return true;
  if (field === 'start' || field === 'target') return placementEnds(type, iterationBars).includes(field);
  return field !== 'horizon' && field !== 'iteration' && field !== 'iterationGoal';
}
