import {
  hasTag, linkpathFromRawValue, normalizeTag, ownValue, readDate, readString, readTags, reversedSpan, sameCivil, setOwn,
  type CivilDate, type Frontmatter,
} from './fields.ts';
import { deliverableStateKey, isDoneValue, optionalKeyFor, testStateKey, type BacklogSettings } from './settings.ts';
import { isReleaseType, isResourceType, mayHoldField, placementEnds, type HeldField, type PlacementEnd } from './vocabulary.ts';

/** Planned horizon and dates. `ends` names the dates the planner expected the live type to hold; `fillOnly` fills only empty dates. */
export interface AxisWrite { horizon?: string | null; start?: string | null; target?: string | null; ends?: PlacementEnd[]; fillOnly?: boolean }

/**
 * backlog-view's `ItemWrite`: one note's planned frontmatter change. Targets are vault paths; `null` removes a
 * key. Writes go through `applyItemWrite`, which re-checks the live note before touching it.
 */
export interface ItemWrite {
  path: string;
  parent?: string | null; order?: number; typeName?: string;
  state?: string; removeStateKey?: boolean;
  deliverableState?: string; removeDeliverableStateKey?: boolean;
  testState?: string; removeTestStateKey?: boolean;
  startedDate?: string; finish?: { date: string; toDone: boolean };
  axis?: AxisWrite;
  risk?: string | null; priority?: string | null; iterationGoal?: string | null;
  assignee?: string | null; iteration?: string | null; release?: string | null;
  dependsOn?: { add?: string; removePath?: string; removeRaw?: string };
  tags?: { add?: string[]; remove?: string[] };
}

/** What a write needs of the vault: link text, link resolution and the live type of a link target. */
export interface WriteEnv {
  settings: BacklogSettings;
  /** `[[<fileToLinktext(target, source)>]]`. */
  wikilink(target: string, source: string): string;
  resolve(linkpath: string, source: string): string | null;
  typeOf(path: string): string | null;
}

export type WriteRefusal = 'resource' | 'field-not-held' | 'not-a-release' | 'not-a-resource' | 'reversed-span';

const axisFields = ['horizon', 'start', 'target'] as const;
const axisEntries = (settings: BacklogSettings, axis?: AxisWrite) => axisFields
  .map(field => ({ field, key: optionalKeyFor(settings, field), value: axis?.[field] }))
  .filter((entry): entry is { field: typeof axisFields[number]; key: string; value: string | null } => entry.key !== '' && entry.value !== undefined);

function liveEnd(frontmatter: Frontmatter, settings: BacklogSettings, field: PlacementEnd): CivilDate | null {
  const key = optionalKeyFor(settings, field);
  return key === '' ? null : readDate(ownValue(frontmatter, key)).value;
}

/** Whether a release write still changes the membership (the note does not already name exactly that release). */
function stillJoining(frontmatter: Frontmatter, write: ItemWrite, env: WriteEnv): boolean {
  const target = write.release, key = env.settings.releaseKey;
  if (!target || !key) return false;
  const raw = ownValue(frontmatter, key);
  if (Array.isArray(raw) && raw.length !== 1) return true;
  const scalar: unknown = Array.isArray(raw) ? raw[0] : raw;
  const text = typeof scalar === 'string' ? readString(scalar) : null;
  if (text === null) return true;
  return env.resolve(linkpathFromRawValue(text), write.path) !== target;
}

/** The planned dates a fill-only write leaves out: anything already set, and anything that would reverse the span. */
function suppressedAxis(frontmatter: Frontmatter, write: ItemWrite, env: WriteEnv): Set<string> {
  if (!write.axis?.fillOnly) return new Set();
  if (!stillJoining(frontmatter, write, env)) return new Set(axisFields);
  const liveStart = liveEnd(frontmatter, env.settings, 'start'), liveTarget = liveEnd(frontmatter, env.settings, 'target');
  const wanted = optionalKeyFor(env.settings, 'target') === '' ? null : readDate(write.axis.target).value;
  const skip = new Set<string>();
  if (liveTarget !== null || reversedSpan(liveStart, wanted)) skip.add('target');
  const due = liveTarget ?? (skip.has('target') ? null : wanted);
  if (liveStart !== null || reversedSpan(readDate(write.axis.start).value, due)) skip.add('start');
  return skip;
}

/** The live-note checks of backlog-view's `applyWrites`; the first failing check names the refusal. */
function refusal(frontmatter: Frontmatter, write: ItemWrite, env: WriteEnv): WriteRefusal | null {
  const { settings } = env;
  const liveType = readString(ownValue(frontmatter, settings.typeKey));
  if (isResourceType(liveType)) return 'resource';
  const stated: [HeldField, unknown][] = [
    ['horizon', write.axis?.horizon], ['start', write.axis?.start], ['target', write.axis?.target],
    ['iteration', write.iteration], ['iterationGoal', write.iterationGoal], ['release', write.release],
  ];
  if (stated.some(([field, value]) => value !== undefined && value !== null && !mayHoldField(liveType, field, settings.iterationBars))) return 'field-not-held';
  if (write.release && !isReleaseType(env.typeOf(write.release))) return 'not-a-release';
  if (write.assignee && !isResourceType(env.typeOf(write.assignee))) return 'not-a-resource';
  const axis = write.axis;
  if (axis?.ends !== undefined) {
    const live = placementEnds(liveType, settings.iterationBars);
    if (live.length !== axis.ends.length || live.some(end => !axis.ends!.includes(end))) return 'field-not-held';
    if (live.length === 2) {
      const requested = (field: PlacementEnd) => {
        const value = axis[field];
        if (value === undefined) return liveEnd(frontmatter, settings, field);
        return value === null ? null : readDate(value).value;
      };
      if (reversedSpan(requested('start'), requested('target'))) return 'reversed-span';
    }
  }
  return null;
}

/** A planned date keeps an existing time suffix (`2026-01-02T09:00` stays timed). */
function mergeDate(live: unknown, requested: string): unknown {
  if (Array.isArray(live) && live.length > 0) return [mergeDate(live[0], requested), ...live.slice(1)];
  if (typeof live !== 'string' || readDate(live).value === null) return requested;
  const match = /^\d{4}-\d{1,2}-\d{1,2}([Tt\s].*)$/.exec(live.trim());
  return match ? `${requested}${match[1]}` : requested;
}

const remove = (frontmatter: Frontmatter, key: string) => { delete frontmatter[key]; };
const isBlank = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' ? value.trim() === '' : Array.isArray(value) && value.every(isBlank));

function applyDependsOn(frontmatter: Frontmatter, write: ItemWrite, env: WriteEnv): void {
  const delta = write.dependsOn, key = env.settings.dependsOnKey;
  if (!delta || !key) return;
  const raw = ownValue(frontmatter, key);
  const current: unknown[] = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const textOf = (value: unknown) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null);
  const pathOf = (text: string) => { const linkpath = linkpathFromRawValue(text); return linkpath ? env.resolve(linkpath, write.path) : null; };
  const next = current.filter(value => {
    const text = textOf(value);
    return text === null || !((delta.removeRaw !== undefined && text === delta.removeRaw) || (delta.removePath !== undefined && pathOf(text) === delta.removePath));
  });
  let changed = next.length !== current.length;
  if (delta.add && !next.some(value => { const text = textOf(value); return text !== null && pathOf(text) === delta.add; })) {
    next.push(env.wikilink(delta.add, write.path));
    changed = true;
  }
  if (!changed) return;
  if (next.length > 0) setOwn(frontmatter, key, next); else remove(frontmatter, key);
}

function applyTags(frontmatter: Frontmatter, key: string, delta: NonNullable<ItemWrite['tags']>): void {
  const current = readTags(ownValue(frontmatter, key));
  const removals = delta.remove ?? [];
  const next = current.filter(tag => !hasTag(removals, tag));
  let changed = next.length !== current.length;
  for (const tag of (delta.add ?? []).map(normalizeTag)) if (tag.length > 0 && !hasTag(next, tag)) { next.push(tag); changed = true; }
  if (!changed) return;
  if (next.length > 0) setOwn(frontmatter, key, next); else remove(frontmatter, key);
}

/**
 * Applies one write to a live frontmatter object in place, exactly as backlog-view's `applyInto` does, after its
 * refusal checks. Returns the refusal, or null when the write was applied (possibly as a no-op).
 */
export function applyItemWrite(frontmatter: Frontmatter, write: ItemWrite, env: WriteEnv): WriteRefusal | null {
  const refused = refusal(frontmatter, write, env);
  if (refused) return refused;
  const { settings } = env;
  const leaving = settings.stateKey ? readString(ownValue(frontmatter, settings.stateKey)) : null;
  const skip = suppressedAxis(frontmatter, write, env);
  const axis = axisEntries(settings, write.axis).filter(entry => !skip.has(entry.field));
  const lands = !write.axis?.fillOnly || stillJoining(frontmatter, write, env);
  if (write.parent !== undefined) {
    if (write.parent !== null) setOwn(frontmatter, settings.parentKey, env.wikilink(write.parent, write.path));
    else if (settings.folderHierarchy) setOwn(frontmatter, settings.parentKey, '');
    else remove(frontmatter, settings.parentKey);
  }
  if (write.order !== undefined) setOwn(frontmatter, settings.orderKey, write.order);
  if (write.typeName !== undefined) setOwn(frontmatter, settings.typeKey, write.typeName);
  const links: [string | null | undefined, string][] = [[write.iteration, settings.iterationKey], [lands ? write.release : undefined, settings.releaseKey], [write.assignee, settings.assigneeKey]];
  for (const [target, key] of links) {
    if (target === undefined || !key) continue;
    if (target === null) remove(frontmatter, key); else setOwn(frontmatter, key, env.wikilink(target, write.path));
  }
  const states: [string | undefined, boolean | undefined, string][] = [
    [write.state, write.removeStateKey, settings.stateKey],
    [write.deliverableState, write.removeDeliverableStateKey, deliverableStateKey(settings)],
    [write.testState, write.removeTestStateKey, testStateKey(settings)],
  ];
  for (const [value, removeKey, key] of states) {
    if (!key) continue;
    if (removeKey) remove(frontmatter, key); else if (value !== undefined) setOwn(frontmatter, key, value);
  }
  const movesState = write.state !== undefined && (leaving === null || leaving.toLowerCase() !== write.state.toLowerCase());
  if (write.startedDate !== undefined && settings.startedDateKey && movesState && isBlank(ownValue(frontmatter, settings.startedDateKey))) {
    setOwn(frontmatter, settings.startedDateKey, write.startedDate);
  }
  if (write.finish !== undefined && settings.finishedDateKey && write.finish.toDone !== isDoneValue(settings, leaving)) {
    if (write.finish.toDone) setOwn(frontmatter, settings.finishedDateKey, write.finish.date); else remove(frontmatter, settings.finishedDateKey);
  }
  for (const { field, key, value } of axis) {
    if (value === null) { remove(frontmatter, key); continue; }
    if (field === 'horizon') { setOwn(frontmatter, key, value); continue; }
    const live = readDate(ownValue(frontmatter, key));
    if (!live.invalid && live.value !== null && sameCivil(live.value, readDate(value).value)) continue;
    setOwn(frontmatter, key, mergeDate(ownValue(frontmatter, key), value));
  }
  const labels: [string | null | undefined, string][] = [[write.risk, settings.riskKey], [write.priority, settings.priorityKey], [write.iterationGoal, settings.iterationGoalKey]];
  for (const [value, key] of labels) {
    if (value === undefined || !key) continue;
    if (value === null) remove(frontmatter, key); else setOwn(frontmatter, key, value);
  }
  if (write.tags && settings.tagsKey) applyTags(frontmatter, settings.tagsKey, write.tags);
  applyDependsOn(frontmatter, write, env);
  return null;
}
