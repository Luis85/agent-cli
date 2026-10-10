import { FOLDER_OPTION_TYPES, RELEASE_TYPE, defaultResourceFolder, defaultTypeFolder, typeFolderKey } from './vocabulary.ts';
import { sameValue } from './fields.ts';
import {
  DEFAULT_ITERATION_DAYS, OPTIONAL_PROPERTIES, STATE_COLOR_NAMES, defaultSettings, nameTable, ownedProperties, type BacklogSettings,
} from './settings.ts';

/**
 * Reading a `.base` view's stored options exactly as backlog-view's `settingsResolve.ts` and `releaseOptions.ts`
 * do. `view` is the view's YAML mapping. Property options are Bases property ids (`note.status`); a bare name is
 * read as a note property, like the names Bases lists in `order`. Lists are comma-separated strings. A
 * "clearable" option means its default while absent and off while present but empty.
 */
export type ViewOptions = Readonly<Record<string, unknown>>;

/** Obsidian's `normalizePath`: one `/` separator, no leading or trailing slash, NFC, non-breaking spaces as spaces. */
export function normalizePath(path: string): string {
  const cleaned = path.replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '').replace(/[  ]/g, ' ').normalize('NFC');
  return cleaned === '' ? '/' : cleaned;
}
/** A user-typed folder as the vault spells it; `''` is the vault root. */
export function vaultFolder(value: string): string {
  const trimmed = value.trim().replace(/^[\\/]+|[\\/]+$/g, '');
  return trimmed ? normalizePath(trimmed) : '';
}

function parseListValue(raw: string): string[] {
  return raw.split(',').map(value => value.trim()).filter(value => value.length > 0);
}

/** The primitive option readers (`configReaders` in backlog-view). */
function configReaders(view: ViewOptions) {
  const get = (key: string): unknown => (Object.hasOwn(view, key) ? view[key] : undefined);
  const propKey = (key: string, fallback: string): string => {
    const raw = get(key);
    if (typeof raw !== 'string' || raw.trim() === '') return fallback;
    const id = raw.trim(), dot = id.indexOf('.');
    if (dot < 0) return id;
    const namespace = id.slice(0, dot), name = id.slice(dot + 1);
    return namespace === 'note' && name ? name : ['file', 'formula'].includes(namespace) ? fallback : id;
  };
  const clearablePropKey = (key: string, fallback: string) => (get(key) === undefined ? fallback : propKey(key, ''));
  const clearable = <T>(key: string, fallback: T, parse: () => T): T => (get(key) === undefined ? fallback : parse());
  const str = (key: string) => { const value = get(key); return typeof value === 'string' ? value : ''; };
  const bool = (key: string, fallback: boolean) => { const value = get(key); return typeof value === 'boolean' ? value : fallback; };
  const list = (key: string) => parseListValue(str(key));
  const dedupe = (values: string[]) => values.filter((value, index) => values.findIndex(other => sameValue(other, value)) === index);
  return { get, propKey, clearablePropKey, clearable, str, bool, list, dedupe };
}

function parseWipLimit(raw: string): number | null {
  const n = Number(raw.trim());
  return raw.trim() !== '' && Number.isInteger(n) && n >= 1 ? n : null;
}
function resolveIterationDays(raw: string): number {
  const n = Number(raw.trim());
  return raw.trim() !== '' && Number.isInteger(n) && n > 0 ? n : DEFAULT_ITERATION_DAYS;
}
function stateColor(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(value) || STATE_COLOR_NAMES.includes(value) ? value : null;
}

interface Secondary { key: string; states: string[]; doneValues: string[] }
function secondaryWorkflow(read: ReturnType<typeof configReaders>, names: { property: string; states: string; done: string }, fallbackDone: string[], states: string[], effectiveDone: string[]): Secondary {
  const key = read.propKey(names.property, '');
  const fallsBack = key === '';
  const doneRaw = read.list(names.done);
  const statesRaw = read.dedupe(read.list(names.states));
  return {
    key,
    states: fallsBack && statesRaw.length === 0 ? states : statesRaw,
    doneValues: doneRaw.length > 0 ? doneRaw : fallsBack ? effectiveDone : fallbackDone,
  };
}

/** `resolveSettings`: one `product-backlog` view's options with every default applied. */
export function resolveSettings(view: ViewOptions): BacklogSettings {
  const fallback = defaultSettings();
  const read = configReaders(view);
  const { propKey, clearablePropKey, clearable, str, bool, list, dedupe } = read;
  const doneValues = list('doneValues');
  const effectiveDone = doneValues.length > 0 ? doneValues : fallback.doneValues;
  const states = dedupe(list('stateValues'));
  const deliverable = secondaryWorkflow(read, { property: 'deliverableStateProperty', states: 'deliverableStateValues', done: 'deliverableDoneValues' }, fallback.deliverableDoneValues, states, effectiveDone);
  const test = secondaryWorkflow(read, { property: 'testStateProperty', states: 'testStateValues', done: 'testDoneValues' }, fallback.testDoneValues, states, effectiveDone);
  const isDone = (state: string) => effectiveDone.some(done => sameValue(done, state));
  const homeFolder = clearable('homeFolder', fallback.homeFolder, () => vaultFolder(str('homeFolder')));
  const optional = Object.fromEntries(OPTIONAL_PROPERTIES.map(property => [property.settingsKey, propKey(property.option, fallback[property.settingsKey])]));
  const parentKey = propKey('parentProperty', fallback.parentKey), orderKey = propKey('orderProperty', fallback.orderKey), typeKey = propKey('typeProperty', fallback.typeKey);
  const tagsKey = clearablePropKey('tagsProperty', fallback.tagsKey);
  const colourable = states.filter(state => !isDone(state));
  for (const state of deliverable.states.filter(state => !deliverable.doneValues.some(done => sameValue(done, state)))) {
    if (!colourable.some(own => sameValue(own, state))) colourable.push(state);
  }
  const openIn = str('openIn');
  return {
    ...fallback, ...optional,
    parentKey, orderKey, typeKey,
    hierarchyOnly: bool('hierarchyOnly', fallback.hierarchyOnly),
    iterationsOnTimeline: bool('iterationsOnTimeline', fallback.iterationsOnTimeline),
    iterationBars: bool('iterationBars', fallback.iterationBars),
    showOutsideParents: bool('showOutsideParents', fallback.showOutsideParents),
    folderHierarchy: bool('inferFolderHierarchy', fallback.folderHierarchy),
    showCounts: bool('showCounts', fallback.showCounts),
    homeFolder,
    typeFolders: nameTable(FOLDER_OPTION_TYPES, type => clearable(typeFolderKey(type), defaultTypeFolder(type, homeFolder), () => vaultFolder(str(typeFolderKey(type)))) || null),
    resourceFolder: clearable('resourceFolder', defaultResourceFolder(homeFolder), () => vaultFolder(str('resourceFolder'))),
    tagsKey: [parentKey, orderKey, typeKey, optional.stateKey].includes(tagsKey) ? '' : tagsKey,
    releaseDateKey: clearablePropKey('releaseDateProperty', fallback.releaseDateKey),
    doneValues: effectiveDone,
    wipLimits: nameTable(states.filter(state => !isDone(state)), state => parseWipLimit(str(`wipLimit.${state.toLowerCase()}`))),
    columnPolicies: nameTable(states, state => str(`columnPolicy.${state.toLowerCase()}`).trim() || null),
    stateColors: nameTable(colourable, state => stateColor(str(`stateColor.${state.toLowerCase()}`))),
    startedStates: dedupe(list('startedStates')),
    states,
    horizonValues: clearable('horizonValues', fallback.horizonValues, () => dedupe(list('horizonValues'))),
    deliverableStateKey: deliverable.key, deliverableStates: deliverable.states, deliverableDoneValues: deliverable.doneValues,
    testStateKey: test.key, testStates: test.states, testDoneValues: test.doneValues,
    riskValues: clearable('riskValues', fallback.riskValues, () => dedupe(list('riskValues'))),
    priorityValues: clearable('priorityValues', fallback.priorityValues, () => dedupe(list('priorityValues'))),
    iterationOpenStates: dedupe(list('iterationOpenStates')),
    iterationResolvedStates: dedupe(list('iterationResolvedStates')),
    iterationLengthDays: resolveIterationDays(str('iterationLengthDays')),
    openIn: openIn === 'tab' || openIn === 'split' ? openIn : 'active',
  };
}

/** One `product-release` view's options (`ReleaseSettings` in backlog-view). */
export interface ReleaseSettings {
  parentKey: string; orderKey: string; typeKey: string;
  membershipKey: string; versionKey: string; targetDateKey: string; statusKey: string; releasedDateKey: string;
  descriptionKey: string; estimateKey: string; capacityKey: string; capacityUnit: string;
  dependsOnKey: string; riskKey: string; criticalRiskValues: string[]; addressedRiskValues: string[];
  statusValues: string[]; releasedValues: string[]; releasedTransition: string; notesFolder: string; folder: string;
}

export function resolveReleaseSettings(view: ViewOptions): ReleaseSettings {
  const { clearablePropKey, propKey, str, clearable, list, dedupe } = configReaders(view);
  return {
    parentKey: clearablePropKey('parentProperty', 'parent'), orderKey: clearablePropKey('orderProperty', 'order'), typeKey: clearablePropKey('typeProperty', 'type'),
    membershipKey: propKey('membershipProperty', ''), versionKey: propKey('versionProperty', ''), targetDateKey: propKey('targetDateProperty', ''),
    statusKey: propKey('releaseStatusProperty', ''), releasedDateKey: propKey('releasedDateProperty', ''), descriptionKey: propKey('descriptionProperty', ''),
    estimateKey: propKey('estimateProperty', ''), capacityKey: propKey('capacityProperty', ''), capacityUnit: str('capacityUnit').trim(),
    dependsOnKey: propKey('dependsOnProperty', ''), riskKey: propKey('riskProperty', ''),
    criticalRiskValues: dedupe(list('criticalRiskValues')), addressedRiskValues: dedupe(list('addressedRiskValues')),
    statusValues: dedupe(list('releaseStatusValues')), releasedValues: list('releasedStatusValues'),
    releasedTransition: str('releasedTransitionValue').trim(), notesFolder: str('releaseNotesFolder'),
    folder: clearable('releaseFolder', defaultTypeFolder(RELEASE_TYPE), () => vaultFolder(str('releaseFolder'))),
  };
}

function releaseOwned(settings: ReleaseSettings): { role: string; key: string }[] {
  return [
    { role: 'type', key: settings.typeKey }, { role: 'parent', key: settings.parentKey }, { role: 'order', key: settings.orderKey },
    { role: 'version', key: settings.versionKey }, { role: 'target-date', key: settings.targetDateKey }, { role: 'release status', key: settings.statusKey },
    { role: 'released date', key: settings.releasedDateKey }, { role: 'description', key: settings.descriptionKey }, { role: 'capacity', key: settings.capacityKey },
  ];
}

/** `releaseNoteProblems`: release properties sharing a key, released = target date, a transition that is not released. */
export function releaseNoteProblems(settings: ReleaseSettings): string[] {
  const keys = new Map<string, string[]>();
  for (const { role, key } of releaseOwned(settings)) if (key) keys.set(key, [...(keys.get(key) ?? []), role]);
  const problems = [...keys].filter(([, roles]) => roles.length > 1).map(([key, roles]) => `The release properties ${roles.join(', ')} all use the key "${key}".`);
  if (settings.releasedDateKey !== '' && settings.releasedDateKey === settings.targetDateKey) problems.push(`The released date and the target date share the key "${settings.releasedDateKey}".`);
  if (settings.releasedTransition !== '' && settings.releasedValues.length > 0 && !settings.releasedValues.some(value => sameValue(value, settings.releasedTransition))) {
    problems.push(`The released transition value "${settings.releasedTransition}" is not one of the released status values.`);
  }
  return problems;
}

/** The membership key colliding with another role of the plan or of the release note. */
export function membershipCollision(release: ReleaseSettings, plan: BacklogSettings): string | null {
  if (release.membershipKey === '') return null;
  const owners = [...ownedProperties(plan).filter(owned => owned.role !== 'release'), ...releaseOwned(release)];
  const owner = owners.find(({ key }) => key !== '' && key === release.membershipKey);
  return owner ? `The release membership key "${release.membershipKey}" is also the ${owner.role} property.` : null;
}
