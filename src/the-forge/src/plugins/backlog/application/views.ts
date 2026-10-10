import { formatCivil, type CivilDate, type FieldReading } from '../domain/fields.ts';
import { requirementsBoard } from '../domain/board.ts';
import { checkBacklog } from '../domain/check.ts';
import { displayType, type BacklogItem } from '../domain/model.ts';
import { membershipTarget } from '../domain/releases.ts';
import { configProblems } from '../domain/settings.ts';
import { membershipCollision, releaseNoteProblems } from '../domain/settings-resolve.ts';
import { inCatalog } from '../domain/vocabulary.ts';
import { findItem, typeOf, type BacklogSession } from './session.ts';

const date = (reading: FieldReading<CivilDate>) => (reading.invalid ? { invalid: true } : reading.value === null ? null : formatCivil(reading.value));
const link = (entry: { raw: string; path: string | null } | null) => (entry === null ? null : { raw: entry.raw, path: entry.path });

/** The JSON of one item; `rank` is its 1-based position in the global rank. */
function itemJson(session: BacklogSession, item: BacklogItem) {
  const rank = session.model.ranked.indexOf(item);
  return {
    path: item.path, title: item.title, id: item.pblId, type: item.typeName, displayType: displayType(item), impliedType: item.impliedType,
    ladder: inCatalog(item) ? 'test' : 'plan', level: item.levelIndex, depth: item.depth,
    parent: item.parent?.path ?? null, orphan: item.orphan, context: item.outsideFilter,
    order: item.order, rank: rank < 0 ? null : rank + 1,
    state: item.stateValue, done: item.done,
    ...(item.deliverableStateValue !== null && item.deliverableStateValue !== item.stateValue ? { deliverableState: item.deliverableStateValue } : {}),
    ...(item.testStateValue !== null && item.testStateValue !== item.stateValue ? { testState: item.testStateValue } : {}),
    horizon: item.horizon.invalid ? { invalid: true } : item.horizon.value, start: date(item.plannedStart), due: date(item.plannedTarget),
    risk: item.riskValue, priority: item.priorityValue, assignee: link(item.assigneeEntry), iteration: link(item.iterationEntry), release: link(item.releaseEntry),
    ...(item.iterationGoalValue !== null ? { goal: item.iterationGoalValue } : {}),
    tags: item.tags,
    dependsOn: item.prerequisites.map(prerequisite => prerequisite.path), brokenDependencies: item.brokenPrerequisites,
    children: item.children.length, descendants: item.descendantCount, doneDescendants: item.doneDescendants,
  };
}

const header = (session: BacklogSession) => ({ base: session.base.path, view: session.view.name });

/** `backlog list`: every item by global rank (context rows only with `context`). */
export function listItems(session: BacklogSession, includeContext: boolean) {
  const items = session.model.ranked.filter(item => includeContext || !item.outsideFilter);
  return { ...header(session), total: items.length, items: items.map(item => itemJson(session, item)), ignored: session.model.ignored };
}

/** `backlog tree`: the hierarchy in sibling rank order; context rows place results under their ancestors. */
export function itemTree(session: BacklogSession) {
  type Node = ReturnType<typeof itemJson> & { items: Node[] };
  const node = (item: BacklogItem): Node => ({ ...itemJson(session, item), items: item.children.map(node) });
  return { ...header(session), roots: session.model.roots.map(node), ignored: session.model.ignored };
}

/** `backlog board`: columns by state with WIP limits; the first column holds items without a state. */
export function board(session: BacklogSession) {
  if (!session.settings.stateKey) return { ...header(session), stateProperty: null, columns: [] };
  return {
    ...header(session), stateProperty: session.settings.stateKey,
    columns: requirementsBoard(session.model, session.settings).map(column => ({
      state: column.state, done: column.done, outsideWorkflow: column.outsideWorkflow, limit: column.limit,
      over: column.limit === null ? 0 : Math.max(0, column.held - column.limit), policy: column.policy, count: column.count,
      cards: column.cards.map(card => ({ path: card.path, title: card.title, type: card.typeName, context: card.outsideFilter })),
    })),
  };
}

/** `backlog show`: one item with its children, prerequisites and dependents. */
export function showItem(session: BacklogSession, reference: string) {
  const item = findItem(session, reference);
  const dependents = session.model.items.filter(other => other.prerequisites.includes(item)).map(other => other.path);
  return {
    ...header(session), item: itemJson(session, item),
    ancestors: (() => { const chain: string[] = []; for (let up = item.parent; up; up = up.parent) chain.unshift(up.path); return chain; })(),
    childItems: item.children.map(child => ({ path: child.path, title: child.title, type: child.typeName, order: child.order, state: child.stateValue })),
    dependents,
  };
}

/** `backlog check`: problems found reading the backlog; `ok` is false when any is an error. */
export function check(session: BacklogSession) {
  const release = session.releaseView;
  const releasePaths = new Set(session.model.releases.map(entry => entry.path));
  const memberships = release
    ? session.model.items.filter(item => !item.outsideFilter && membershipTarget(session.source, item, releasePaths, release.settings) === 'unresolved').map(item => item.path)
    : [];
  const releaseProblems = release ? [...releaseNoteProblems(release.settings), ...[membershipCollision(release.settings, session.settings)].filter((problem): problem is string => problem !== null)] : [];
  const problems = checkBacklog({ model: session.model, settings: session.settings, releaseProblems, unresolvedMemberships: memberships, typeOf: path => typeOf(session, path) });
  return {
    ...header(session), ok: !problems.some(problem => problem.severity === 'error'),
    counts: { items: session.model.items.filter(item => !item.outsideFilter).length, context: session.model.items.filter(item => item.outsideFilter).length, ignored: session.model.ignored.length, errors: problems.filter(problem => problem.severity === 'error').length, warnings: problems.filter(problem => problem.severity === 'warning').length },
    writable: configProblems(session.settings).length === 0,
    problems,
  };
}
