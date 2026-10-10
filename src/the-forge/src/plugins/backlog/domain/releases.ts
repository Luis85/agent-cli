import { daysBetween, linkpathFromRawValue, ownValue, readSoleDate, readString, sameValue, type CivilDate, type FieldReading } from './fields.ts';
import type { NoteSource } from './items.ts';
import { inPlan, type BacklogItem, type BacklogModel } from './model.ts';
import { deliverableStateKey, testStateKey, type BacklogSettings } from './settings.ts';
import { vaultFolder, type ReleaseSettings } from './settings-resolve.ts';
import { ALL_TYPES, inCatalog, isDeliverableType, isMarkerType } from './vocabulary.ts';

/** A release figure: a value, an unreadable value, or a property the release view leaves unbound. */
export interface ReleaseFigure<T> { value: T | null; invalid: boolean; unconfigured: boolean }
const unconfigured = <T>(): ReleaseFigure<T> => ({ value: null, invalid: false, unconfigured: true });
const figure = <T>(reading: FieldReading<T>): ReleaseFigure<T> => ({ ...reading, unconfigured: false });
function readLabel(raw: unknown): FieldReading<string> {
  if (raw === null || raw === undefined) return { value: null, invalid: false };
  if (Array.isArray(raw)) return { value: null, invalid: true };
  const text = readString(raw);
  return text === null ? { value: null, invalid: true } : { value: text, invalid: false };
}

type WorkflowKind = 'requirements' | 'deliverable' | 'test';
const workflowKind = (item: BacklogItem): WorkflowKind => (isDeliverableType(item.typeName) ? 'deliverable' : inCatalog(item) ? 'test' : 'requirements');
/** The item's state in its own workflow (Deliverables and test items have their own). */
function ownWorkflowReading(item: BacklogItem): { value: string | null; done: boolean } {
  const kind = workflowKind(item);
  if (kind === 'deliverable') return { value: item.deliverableStateValue, done: item.deliverableDone };
  if (kind === 'test') return { value: item.testStateValue, done: item.testDone };
  return { value: item.stateValue, done: item.done };
}
function workflowClears(kind: WorkflowKind, plan: BacklogSettings): boolean {
  const [key, done] = kind === 'deliverable' ? [deliverableStateKey(plan), plan.deliverableDoneValues] : kind === 'test' ? [testStateKey(plan), plan.testDoneValues] : [plan.stateKey, plan.doneValues];
  return key !== '' && done.length > 0;
}

/** backlog-view's `membershipTarget`: the release path an item belongs to, `'unresolved'`, or null when it names none. */
export function membershipTarget(source: NoteSource, item: BacklogItem, releasePaths: ReadonlySet<string>, settings: ReleaseSettings): string | 'unresolved' | null {
  if (!settings.membershipKey) return null;
  const raw = ownValue(source.frontmatter(item.path), settings.membershipKey);
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    if (raw.length > 1) return 'unresolved';
  }
  const scalar: unknown = Array.isArray(raw) ? raw[0] : raw;
  const text = typeof scalar === 'string' ? readString(scalar) : null;
  if (text === null || !inPlan(item) || isMarkerType(item.typeName)) return 'unresolved';
  const path = source.resolve(linkpathFromRawValue(text), item.path);
  return path !== null && releasePaths.has(path) ? path : 'unresolved';
}

export interface ReleaseRow {
  path: string; name: string; item: BacklogItem;
  version: ReleaseFigure<string>; target: ReleaseFigure<CivilDate>; status: ReleaseFigure<string>; description: ReleaseFigure<string>;
  released: ReleaseFigure<CivilDate>; members: ReleaseFigure<number>; done: ReleaseFigure<number>;
  shipped: boolean; overdue: boolean; daysToTarget: number | null; slip: number | null;
}

/** The release index: one row per Release note (open by target date, then shipped by release date) and the unresolved memberships. */
export function releaseIndex(source: NoteSource, model: BacklogModel, settings: ReleaseSettings, plan: BacklogSettings, today: CivilDate): { rows: ReleaseRow[]; unresolved: BacklogItem[] } {
  const releasePaths = new Set(model.releases.map(release => release.path));
  const counts = new Map<string, number>(), done = new Map<string, number>(), kinds = new Map<string, Set<WorkflowKind>>();
  const unresolved: BacklogItem[] = [];
  for (const item of model.items.filter(entry => !entry.outsideFilter)) {
    const named = membershipTarget(source, item, releasePaths, settings);
    if (named === null) continue;
    if (named === 'unresolved') { unresolved.push(item); continue; }
    counts.set(named, (counts.get(named) ?? 0) + 1);
    if (ownWorkflowReading(item).done) done.set(named, (done.get(named) ?? 0) + 1);
    kinds.set(named, new Set([...(kinds.get(named) ?? []), workflowKind(item)]));
  }
  const key = (date: CivilDate | null) => (date === null ? Number.POSITIVE_INFINITY : date.year * 10000 + date.month * 100 + date.day);
  const rows = model.releases.map((item): ReleaseRow => {
    const frontmatter = source.frontmatter(item.path);
    const read = <T>(property: string, reader: (raw: unknown) => FieldReading<T>) => (property ? figure(reader(ownValue(frontmatter, property))) : unconfigured<T>());
    const target = read(settings.targetDateKey, readSoleDate), released = read(settings.releasedDateKey, readSoleDate);
    const own = kinds.get(item.path);
    const ready = own === undefined || own.size === 0 ? plan.stateKey !== '' : [...own].every(kind => workflowClears(kind, plan));
    return {
      path: item.path, name: item.title, item,
      version: read(settings.versionKey, readLabel), target, status: read(settings.statusKey, readLabel), description: read(settings.descriptionKey, readLabel), released,
      members: settings.membershipKey ? figure({ value: counts.get(item.path) ?? 0, invalid: false }) : unconfigured(),
      done: settings.membershipKey && ready ? figure({ value: done.get(item.path) ?? 0, invalid: false }) : unconfigured(),
      shipped: released.value !== null, overdue: released.value === null && key(target.value) < key(today),
      daysToTarget: target.value === null ? null : daysBetween(today, target.value),
      slip: target.value !== null && released.value !== null ? daysBetween(target.value, released.value) : null,
    };
  });
  rows.sort((a, b) => {
    if (a.shipped !== b.shipped) return a.shipped ? 1 : -1;
    const compare = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1);
    const within = a.shipped ? compare(key(b.released.value), key(a.released.value)) : compare(key(a.target.value), key(b.target.value));
    if (within !== 0) return within;
    const ra = a.item.order ?? Number.POSITIVE_INFINITY, rb = b.item.order ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return { rows, unresolved };
}

/** A release's scope tree: members in tree order with their non-marker, in-filter ancestors as context rows. */
export interface ScopeRow { item: BacklogItem; depth: number; context: boolean }
export function scopeRows(model: BacklogModel, isMember: (item: BacklogItem) => boolean): ScopeRow[] {
  const members = new Set<string>(), keep = new Set<string>();
  for (const item of model.items) {
    if (item.outsideFilter || !isMember(item)) continue;
    members.add(item.path); keep.add(item.path);
    for (let up = item.parent; up !== null; up = up.parent) if (!isMarkerType(up.typeName) && !up.outsideFilter) keep.add(up.path);
  }
  const rows: ScopeRow[] = [];
  const walk = (item: BacklogItem, depth: number) => {
    const kept = keep.has(item.path);
    if (kept) rows.push({ item, depth, context: !members.has(item.path) });
    for (const child of item.children) walk(child, kept ? depth + 1 : depth);
  };
  for (const root of model.roots) walk(root, 0);
  return rows;
}

type Verdict = 'satisfied' | 'partly' | 'not' | 'unconfigured' | 'empty';
interface Criterion { key: 'estimated' | 'blocked' | 'risk'; verdict: Verdict; cleared: number | null; outstanding: number | null; unreadable: number | null; outstandingPaths: string[] | null }
const verdictOf = (cleared: number, outstanding: number): Verdict => (cleared + outstanding === 0 ? 'empty' : outstanding === 0 ? 'satisfied' : cleared === 0 ? 'not' : 'partly');
const off = (key: Criterion['key']): Criterion => ({ key, verdict: 'unconfigured', cleared: null, outstanding: null, unreadable: null, outstandingPaths: null });

/** A non-negative finite number or numeric string, as an estimate. */
export function estimateValue(raw: unknown): number | null {
  const parsed = typeof raw === 'number' ? (Number.isFinite(raw) ? raw : null)
    : typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw.trim())) ? Number(raw.trim()) : null;
  return parsed === null || parsed < 0 ? null : parsed;
}

/** Readiness over a release's direct members; it writes nothing. */
export function releaseReadiness(source: NoteSource, members: readonly BacklogItem[], settings: ReleaseSettings, plan: BacklogSettings) {
  const fm = (item: BacklogItem, key: string) => ownValue(source.frontmatter(item.path), key);
  const criterion = (key: Criterion['key'], judge: (item: BacklogItem) => { outstanding: boolean; unreadable: boolean }): Criterion => {
    let cleared = 0, unreadable = 0;
    const outstandingPaths: string[] = [];
    for (const item of members) {
      const result = judge(item);
      if (result.unreadable) unreadable++;
      if (result.outstanding) outstandingPaths.push(item.path); else cleared++;
    }
    return { key, verdict: verdictOf(cleared, outstandingPaths.length), cleared, outstanding: outstandingPaths.length, unreadable, outstandingPaths };
  };
  const estimated = settings.estimateKey === '' ? off('estimated') : criterion('estimated', item => ({ outstanding: estimateValue(fm(item, settings.estimateKey)) === null, unreadable: false }));
  const anyWorkflow = (['requirements', 'deliverable', 'test'] as const).some(kind => workflowClears(kind, plan));
  const blocked = settings.dependsOnKey === '' || !anyWorkflow ? off('blocked') : criterion('blocked', item => {
    const raw = fm(item, settings.dependsOnKey);
    const dropped = raw === undefined || raw === null ? 0 : (Array.isArray(raw) ? raw : [raw]).filter(value => value !== null && value !== undefined && typeof value !== 'string').length;
    const broken = dropped > 0 || item.brokenPrerequisites.length > 0;
    const unread = item.prerequisites.some(prerequisite => !workflowClears(workflowKind(prerequisite), plan));
    const waiting = item.prerequisites.some(prerequisite => workflowClears(workflowKind(prerequisite), plan) && !ownWorkflowReading(prerequisite).done);
    return { outstanding: broken || unread || waiting, unreadable: broken || unread };
  });
  const risk = settings.riskKey === '' || settings.criticalRiskValues.length === 0 || settings.addressedRiskValues.length === 0 ? off('risk') : criterion('risk', item => {
    const raw = fm(item, settings.riskKey);
    const entries: unknown[] = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
    const values = entries.map(readString);
    if (values.some(value => value === null)) return { outstanding: true, unreadable: true };
    const held = values as string[];
    const addressed = held.some(value => settings.addressedRiskValues.some(ok => sameValue(value, ok)));
    return { outstanding: !addressed && held.some(value => settings.criticalRiskValues.some(critical => sameValue(value, critical))), unreadable: false };
  });
  const estimates = settings.estimateKey === '' ? null : members.map(item => ({ item, value: estimateValue(fm(item, settings.estimateKey)) }));
  const counting = estimates?.filter(entry => entry.value !== null) ?? [];
  const doneReadable = counting.every(entry => workflowClears(workflowKind(entry.item), plan));
  const sum = (values: number[]) => exactSum(values);
  return {
    members: members.length,
    criteria: [estimated, blocked, risk],
    unestimated: estimates === null ? null : estimates.length - counting.length,
    estimatedEffort: estimates === null ? null : sum(counting.map(entry => entry.value!)),
    completedEffort: estimates === null || !doneReadable ? null : sum(counting.filter(entry => ownWorkflowReading(entry.item).done).map(entry => entry.value!)),
  };
}

const markerOpen = '<!-- Generated by the Product Backlog view from "';
const markerClose = '". Rewritten in full whenever it is regenerated. -->';
const encodeSource = (source: string) => source.replace(/%/g, '%25').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/-(?=-)/g, '%2D');
const decodeSource = (encoded: string) => encoded.replace(/%(0A|0D|25|2D|3C|3E)/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
const sourceComponent = (text: string) => text.replace(/%/g, '%25').replace(/›/g, '%E2%80%BA');

/** `<base path> › <view name> › <release path>`, each part escaped. */
export const releaseNotesSource = (base: string, view: string, release: string) => [base, view, release].map(sourceComponent).join(' › ');

/** The source a generated file's first line names, or null for a file this plugin did not generate. */
export function generatedSource(text: string): string | null {
  const end = text.indexOf('\n');
  const line = (end === -1 ? text : text.slice(0, end)).replace(/^﻿/, '').replace(/\r$/, '').trimEnd();
  if (!line.startsWith(markerOpen) || !line.endsWith(markerClose)) return null;
  const encoded = line.slice(markerOpen.length, line.length - markerClose.length);
  const source = decodeSource(encoded);
  return encodeSource(source) === encoded ? source : null;
}

/** backlog-view's `releaseNotesContent`: deterministic, undated, members grouped by type in vocabulary order. */
export function releaseNotesContent(name: string, rows: readonly ScopeRow[], source: string): string {
  const members = rows.filter(row => !row.context);
  const lines = [`${markerOpen}${encodeSource(source)}${markerClose}`, '', `# ${name}`, '', 'This file is generated. Edits to it do not survive the next regeneration.', '',
    'It lists this release’s members, as its scope tree draws them.', ''];
  if (members.length === 0) return [...lines, 'This release contained nothing.', ''].join('\n');
  const groups: [string, ScopeRow[]][] = ALL_TYPES.map((type): [string, ScopeRow[]] => [type, members.filter(row => sameValue(row.item.typeName, type))]).filter(([, group]) => group.length > 0);
  const others = members.filter(row => !ALL_TYPES.some(type => sameValue(row.item.typeName, type)));
  if (others.length > 0) groups.push(['Other', others]);
  for (const [heading, group] of groups) {
    lines.push(`## ${heading}`, '');
    for (const row of group) lines.push(`- ${row.item.title}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** `<notes folder>/<release basename> release notes.md`. */
export function releaseNotesPath(folder: string, releaseName: string): string {
  const directory = vaultFolder(folder), name = `${releaseName} release notes.md`;
  return directory ? `${directory}/${name}` : name;
}

/** The exact decimal sum of finite numbers, as backlog-view's `exactSum` totals estimates (0.1 + 0.2 is 0.3). */
function exactSum(values: readonly number[]): number {
  let digits = 0n, scale = 0;
  for (const value of values) {
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
    if (match === null) return Number.NaN;
    const [, sign, whole, fraction = '', exponent = '0'] = match;
    const termDigits = BigInt(`${sign}${whole}${fraction}`), termScale = fraction.length - Number(exponent);
    const common = Math.max(scale, termScale);
    digits = digits * 10n ** BigInt(common - scale) + termDigits * 10n ** BigInt(common - termScale);
    scale = common;
  }
  return Number(`${digits}e${-scale}`);
}
