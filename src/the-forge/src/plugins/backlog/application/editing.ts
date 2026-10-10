import { ensure } from '../../../domain/shared/errors.ts';
import { refused } from '../domain/errors.ts';
import { daysBetween, declaredSpelling, formatCivil, readDate, reversedSpan, sameValue } from '../domain/fields.ts';
import { dependentsClosure } from '../domain/dependencies.ts';
import type { BacklogItem } from '../domain/model.ts';
import { isDoneValue, isStartedValue, workflowKey, workflowOf, workflowValues, type BacklogSettings, type Workflow } from '../domain/settings.ts';
import {
  ABSENCE_TYPE, RESOURCE_TYPE, canonicalType, isIterationType, isMarkerType, isReleaseType, placementEnds, sameType,
} from '../domain/vocabulary.ts';
import type { AxisWrite, ItemWrite } from '../domain/writes.ts';
import { findItem, typeOf, type BacklogSession } from './session.ts';
import { announce, writeItems, type WriteResult } from './writer.ts';

/** `backlog set` options. An empty string clears the property (deletes the key). */
export interface SetRequest {
  item: string; ifMatch?: string;
  state?: string; horizon?: string; priority?: string; risk?: string; start?: string; due?: string; assignee?: string; type?: string;
}

const option = (value: string | undefined) => (value === undefined ? undefined : value.trim() === '' ? null : value.trim());
const bound = (key: string, name: string) => {
  if (!key) throw refused('unbound-property', `Bind ${name} in the backlog view first.`, { option: name });
};
/** The item's current state in its own workflow. */
function currentState(item: BacklogItem, workflow: Workflow): string | null {
  return workflow === 'deliverable' ? item.deliverableStateValue : workflow === 'test' ? item.testStateValue : item.stateValue;
}

/** The state write of the item's own workflow; only the requirements workflow stamps started and finished dates. */
function stateWrite(item: BacklogItem, workflow: Workflow, state: string | null, settings: BacklogSettings, today: string): Partial<ItemWrite> | null {
  if (sameValue(currentState(item, workflow), state)) return null;
  if (workflow === 'deliverable') return state === null ? { removeDeliverableStateKey: true } : { deliverableState: state };
  if (workflow === 'test') return state === null ? { removeTestStateKey: true } : { testState: state };
  return {
    ...(state === null ? { removeStateKey: true } : { state }),
    ...(settings.startedDateKey && isStartedValue(settings, state) ? { startedDate: today } : {}),
    ...(settings.finishedDateKey ? { finish: { date: today, toDone: isDoneValue(settings, state) } } : {}),
  };
}

function scheduleWrite(session: BacklogSession, item: BacklogItem, start: string | null | undefined, due: string | null | undefined): AxisWrite | null {
  if (start === undefined && due === undefined) return null;
  const { settings } = session;
  // An iteration's own dialog edits both dates whether or not it draws as a bar; other types follow the schedule gesture.
  const iteration = isIterationType(item.typeName);
  const ends = placementEnds(item.typeName, iteration || settings.iterationBars);
  const axis: AxisWrite = iteration ? {} : { ends };
  for (const [end, value, key, name] of [['start', start, settings.startKey, 'startProperty'], ['target', due, settings.targetKey, 'targetProperty']] as const) {
    if (value === undefined) continue;
    bound(key, name);
    if (!ends.includes(end)) throw refused('field-not-held', `A ${item.typeName ?? 'note'} holds no ${key} date.`, { path: item.path, key });
    ensure(value === null || readDate(value).value !== null, 'INVALID_ARGUMENT', `--${end === 'start' ? 'start' : 'due'} must be a date such as 2026-10-01.`);
    axis[end] = value;
  }
  const date = (value: string | null | undefined, held: BacklogItem['plannedStart']) => (value === undefined ? held.value : value === null ? null : readDate(value).value);
  if (iteration && reversedSpan(date(start, item.plannedStart), date(due, item.plannedTarget))) throw refused('reversed-span', 'The iteration would end before it starts.', { path: item.path });
  return axis;
}

/** `backlog set`: one write combining the requested state, labels, dates, assignee and type. */
export async function setFields(session: BacklogSession, request: SetRequest): Promise<WriteResult & { item: Record<string, unknown> }> {
  const { settings } = session;
  const item = findItem(session, request.item);
  const write: ItemWrite = { path: item.path };
  const today = formatCivil(session.today);
  // A typed state takes the spelling its workflow declares, as a board column writes it.
  const workflow = workflowOf(item.typeName, item.ladder), typed = option(request.state);
  const state = typed === undefined || typed === null ? typed : declaredSpelling(workflowValues(settings, workflow), typed);
  let stateChange: Partial<ItemWrite> | null = null;
  if (state !== undefined) {
    bound(workflowKey(settings, workflow), 'stateProperty');
    stateChange = stateWrite(item, workflow, state, settings, today);
    Object.assign(write, stateChange);
  }
  const horizon = option(request.horizon);
  if (horizon !== undefined) {
    bound(settings.horizonKey, 'horizonProperty');
    if (horizon === null ? item.ownKeys.horizon : !sameValue(item.horizon.value, horizon)) write.axis = { horizon: horizon === null ? null : declaredSpelling(settings.horizonValues, horizon) };
  }
  for (const [field, raw, key, name, values, current] of [['risk', request.risk, settings.riskKey, 'riskProperty', settings.riskValues, item.riskValue], ['priority', request.priority, settings.priorityKey, 'priorityProperty', settings.priorityValues, item.priorityValue]] as const) {
    const value = option(raw);
    if (value === undefined) continue;
    bound(key, name);
    if (value === null ? item.ownKeys[field] : !sameValue(current, value)) write[field] = value === null ? null : declaredSpelling(values, value);
  }
  const schedule = scheduleWrite(session, item, option(request.start), option(request.due));
  if (schedule) write.axis = { ...write.axis, ...schedule };
  const assignee = option(request.assignee);
  if (assignee !== undefined) {
    bound(settings.assigneeKey, 'assigneeProperty');
    const target = assignee === null ? null : session.cache.getFirstLinkpathDest(assignee.replace(/^\[\[|\]\]$/g, ''), session.base.path);
    if (assignee !== null && (target === null || !sameType(typeOf(session, target), RESOURCE_TYPE))) throw refused('not-a-resource', `${assignee} is not a Resource note.`, { assignee });
    if (target === null ? item.ownKeys.assignee : item.assigneeEntry?.path !== target) write.assignee = target;
  }
  if (request.type !== undefined) {
    const typeName = canonicalType(request.type.trim());
    ensure(typeName.length > 0, 'INVALID_ARGUMENT', '--type needs a type name.');
    if ([RESOURCE_TYPE, ABSENCE_TYPE].some(type => sameType(typeName, type))) throw refused('reserved-type', `${typeName} notes are not backlog items.`, { type: typeName });
    if (item.typeName !== typeName) write.typeName = typeName;
  }
  const result = await writeItems(session, [write], request.ifMatch);
  const summary = { path: item.path, title: item.title };
  if (stateChange) await announce(session, result, 'backlog.state-changed', { ...summary, from: currentState(item, workflow), to: state, ...(stateChange.startedDate ? { started: stateChange.startedDate } : {}), ...(stateChange.finish ? { finished: stateChange.finish.toDone ? stateChange.finish.date : null } : {}) });
  return { ...result, item: summary };
}

/** Declared prerequisites by dependent path, over loaded results (the plugin's `declaredMap`). */
function declaredMap(session: BacklogSession): Map<string, string[]> {
  return new Map(session.model.items.filter(item => !item.outsideFilter && !isMarkerType(item.typeName))
    .map(item => [item.path, item.dependsOnEntries.map(entry => entry.path).filter((path): path is string => path !== null && session.model.byPath.has(path))]));
}

/** `backlog depend <item> --on <other>`: appends a wikilink to the item's `dependsOn` list unless it closes a loop. */
export async function depend(session: BacklogSession, reference: string, on: string, ifMatch?: string): Promise<WriteResult & { item: Record<string, unknown> }> {
  bound(session.settings.dependsOnKey, 'dependsOnProperty');
  const item = findItem(session, reference), prerequisite = findItem(session, on);
  if (isMarkerType(item.typeName)) throw refused('marker', `${item.title} is a ${item.typeName}; a marker waits for nothing.`, { path: item.path });
  if (prerequisite.outsideFilter) throw refused('outside-filter', `${prerequisite.path} is outside the filter.`, { path: prerequisite.path });
  const declaredPaths = declaredMap(session);
  if (dependentsClosure(item.path, declaredPaths).has(prerequisite.path)) throw refused('dependency-cycle', `${item.title} cannot wait for ${prerequisite.title}: that closes a dependency loop.`, { path: item.path, on: prerequisite.path });
  const already = (declaredPaths.get(item.path) ?? []).includes(prerequisite.path);
  const result = already ? { dryRun: session.context.workspace.dryRun, changes: [] } : await writeItems(session, [{ path: item.path, dependsOn: { add: prerequisite.path } }], ifMatch);
  return { ...result, item: { path: item.path, on: prerequisite.path } };
}

/** `backlog undepend <item> --on <other>`: removes matching entries (by resolved path, else raw text); deletes the key when empty. */
export async function undepend(session: BacklogSession, reference: string, on: string, ifMatch?: string): Promise<WriteResult & { item: Record<string, unknown> }> {
  bound(session.settings.dependsOnKey, 'dependsOnProperty');
  const item = findItem(session, reference);
  const resolved = session.cache.getFirstLinkpathDest(on.replace(/^\[\[|\]\]$/g, ''), session.base.path);
  const delta = resolved !== null ? { removePath: resolved } : { removeRaw: on.trim() };
  const result = await writeItems(session, [{ path: item.path, dependsOn: delta }], ifMatch);
  return { ...result, item: { path: item.path, removed: result.changes.length > 0 ? (resolved ?? on.trim()) : null } };
}

/** `backlog iteration assign`: links the iteration and overwrites the item's start and target with the iteration's dates. */
export async function assignIteration(session: BacklogSession, reference: string, iterationRef: string, ifMatch?: string): Promise<WriteResult & { item: Record<string, unknown> }> {
  bound(session.settings.iterationKey, 'iterationProperty');
  const item = findItem(session, reference), iteration = findItem(session, iterationRef);
  if (!isIterationType(iteration.typeName) || iteration.outsideFilter) throw refused('not-an-iteration', `${iteration.title} is not an Iteration of this backlog.`, { iteration: iteration.path });
  const axis: AxisWrite = {};
  for (const [end, wanted, held] of [['start', iteration.plannedStart.value, item.plannedStart.value], ['target', iteration.plannedTarget.value, item.plannedTarget.value]] as const) {
    if (wanted === null || (held !== null && daysBetween(wanted, held) === 0)) continue;
    axis[end] = formatCivil(wanted);
  }
  const linkChanges = item.iterationEntry?.path !== iteration.path;
  const write: ItemWrite = { path: item.path, ...(linkChanges ? { iteration: iteration.path } : {}), ...(Object.keys(axis).length > 0 ? { axis } : {}) };
  const result = linkChanges || write.axis ? await writeItems(session, [write], ifMatch) : { dryRun: session.context.workspace.dryRun, changes: [] };
  return { ...result, item: { path: item.path, iteration: iteration.path } };
}

/** `backlog release join`: links the release; fills start (today) and target (the release's target date) only when empty. */
export async function joinRelease(session: BacklogSession, reference: string, releaseRef: string, ifMatch?: string): Promise<WriteResult & { item: Record<string, unknown> }> {
  bound(session.settings.releaseKey, 'releaseProperty');
  const item = findItem(session, reference), release = findItem(session, releaseRef);
  if (!isReleaseType(release.typeName) || release.outsideFilter) throw refused('not-a-release', `${release.title} is not a Release of this backlog.`, { release: release.path });
  const settled = !item.releaseMultiple && item.releaseEntry?.path === release.path;
  const due = release.releaseDate.value;
  const write: ItemWrite = { path: item.path, release: release.path, axis: { fillOnly: true, start: formatCivil(session.today), ...(due ? { target: formatCivil(due) } : {}) } };
  const result = settled ? { dryRun: session.context.workspace.dryRun, changes: [] } : await writeItems(session, [write], ifMatch);
  return { ...result, item: { path: item.path, release: release.path } };
}
