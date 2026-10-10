import { FILED_TYPES, byName, defaultResourceFolder, defaultTypeFolder, DEFAULT_HOME_FOLDER } from './vocabulary.ts';
import { sameValue } from './fields.ts';

/**
 * The resolved configuration of one `product-backlog` view, as backlog-view's `BacklogSettings` holds it. Every
 * key is a plain frontmatter key (without `note.`); `''` means the property is unbound and its feature is off,
 * and the plugin then never writes that key.
 */
export interface BacklogSettings {
  parentKey: string; orderKey: string; typeKey: string;
  hierarchyOnly: boolean; showOutsideParents: boolean; folderHierarchy: boolean; showCounts: boolean;
  homeFolder: string;
  /** Folder per type, keyed by lowercased type name; a missing entry means the home folder. */
  typeFolders: Record<string, string>;
  resourceFolder: string;
  stateKey: string; tagsKey: string;
  doneValues: string[];
  /** Per lowercased non-done state; absent means unlimited. */
  wipLimits: Record<string, number>;
  columnPolicies: Record<string, string>;
  stateColors: Record<string, string>;
  startedDateKey: string; finishedDateKey: string;
  startedStates: string[];
  states: string[];
  horizonKey: string; horizonValues: string[];
  dependsOnKey: string; startKey: string; targetKey: string;
  deliverableStateKey: string; deliverableStates: string[]; deliverableDoneValues: string[];
  testStateKey: string; testStates: string[]; testDoneValues: string[];
  riskKey: string; riskValues: string[];
  priorityKey: string; priorityValues: string[];
  assigneeKey: string; iterationKey: string;
  iterationsOnTimeline: boolean; iterationBars: boolean;
  iterationGoalKey: string; releaseKey: string; releaseDateKey: string;
  iterationOpenStates: string[]; iterationResolvedStates: string[]; iterationLengthDays: number;
  openIn: 'active' | 'tab' | 'split';
}

export type OptionalField = 'state' | 'startedDate' | 'finishedDate' | 'horizon' | 'start' | 'target' | 'risk' | 'priority'
  | 'assignee' | 'deliverableState' | 'testState' | 'dependsOn' | 'iteration' | 'iterationGoal' | 'release';
type OptionalKey = 'stateKey' | 'startedDateKey' | 'finishedDateKey' | 'horizonKey' | 'startKey' | 'targetKey' | 'riskKey'
  | 'priorityKey' | 'assigneeKey' | 'deliverableStateKey' | 'testStateKey' | 'dependsOnKey' | 'iterationKey' | 'iterationGoalKey' | 'releaseKey';
interface OptionalProperty { field: OptionalField; option: string; suggested: string; settingsKey: OptionalKey }

/** backlog-view's `PROPERTY_TABLE`: each optional property's view option, suggested key and settings field. */
export const OPTIONAL_PROPERTIES: readonly OptionalProperty[] = [
  { field: 'state', option: 'stateProperty', suggested: 'status', settingsKey: 'stateKey' },
  { field: 'startedDate', option: 'startedDateProperty', suggested: 'started', settingsKey: 'startedDateKey' },
  { field: 'finishedDate', option: 'finishedDateProperty', suggested: 'finished', settingsKey: 'finishedDateKey' },
  { field: 'horizon', option: 'horizonProperty', suggested: 'horizon', settingsKey: 'horizonKey' },
  { field: 'start', option: 'startProperty', suggested: 'start', settingsKey: 'startKey' },
  { field: 'target', option: 'targetProperty', suggested: 'due', settingsKey: 'targetKey' },
  { field: 'risk', option: 'riskProperty', suggested: 'risk', settingsKey: 'riskKey' },
  { field: 'priority', option: 'priorityProperty', suggested: 'priority', settingsKey: 'priorityKey' },
  { field: 'assignee', option: 'assigneeProperty', suggested: 'assignee', settingsKey: 'assigneeKey' },
  { field: 'deliverableState', option: 'deliverableStateProperty', suggested: 'status', settingsKey: 'deliverableStateKey' },
  { field: 'testState', option: 'testStateProperty', suggested: 'status', settingsKey: 'testStateKey' },
  { field: 'dependsOn', option: 'dependsOnProperty', suggested: 'dependsOn', settingsKey: 'dependsOnKey' },
  { field: 'iteration', option: 'iterationProperty', suggested: 'iteration', settingsKey: 'iterationKey' },
  { field: 'iterationGoal', option: 'iterationGoalProperty', suggested: 'goal', settingsKey: 'iterationGoalKey' },
  { field: 'release', option: 'releaseProperty', suggested: 'release', settingsKey: 'releaseKey' },
];

const DEFAULT_DONE_VALUES = ['Done', 'Closed', 'Completed', 'Removed'];
const DEFAULT_HORIZON_VALUES = ['Now', 'Next', 'Later'];
const DEFAULT_RISK_VALUES = ['1 - High', '2 - Normal', '3 - Low'];
const DEFAULT_PRIORITY_VALUES = ['1 - Must', '2 - Should', '3 - Could', "4 - Won't"];
export const DEFAULT_ITERATION_DAYS = 14;
export const STATE_COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];

/** A table keyed by lowercased name, skipping names `read` has no value for. */
export function nameTable<T>(names: readonly string[], read: (name: string) => T | null = () => null): Record<string, T> {
  const table = Object.create(null) as Record<string, T>;
  for (const name of names) {
    const value = read(name);
    if (value !== null) table[name.toLowerCase()] = value;
  }
  return table;
}

export function defaultSettings(): BacklogSettings {
  return {
    parentKey: 'parent', orderKey: 'order', typeKey: 'type',
    hierarchyOnly: true, showOutsideParents: true, folderHierarchy: false, showCounts: true,
    homeFolder: DEFAULT_HOME_FOLDER,
    typeFolders: nameTable(FILED_TYPES, type => defaultTypeFolder(type) || null),
    resourceFolder: defaultResourceFolder(),
    stateKey: '', tagsKey: 'tags', doneValues: [...DEFAULT_DONE_VALUES],
    wipLimits: nameTable<number>([]), columnPolicies: nameTable<string>([]), stateColors: nameTable<string>([]),
    startedDateKey: '', finishedDateKey: '', startedStates: [], states: [],
    horizonKey: '', horizonValues: [...DEFAULT_HORIZON_VALUES],
    dependsOnKey: '', startKey: '', targetKey: '',
    deliverableStateKey: '', deliverableStates: [], deliverableDoneValues: [...DEFAULT_DONE_VALUES],
    testStateKey: '', testStates: [], testDoneValues: [...DEFAULT_DONE_VALUES],
    riskKey: '', riskValues: [...DEFAULT_RISK_VALUES], priorityKey: '', priorityValues: [...DEFAULT_PRIORITY_VALUES],
    assigneeKey: '', iterationKey: '', iterationsOnTimeline: true, iterationBars: false,
    iterationGoalKey: '', releaseKey: '', releaseDateKey: 'target-date',
    iterationOpenStates: [], iterationResolvedStates: [], iterationLengthDays: DEFAULT_ITERATION_DAYS,
    openIn: 'active',
  };
}

export function optionalKeyFor(settings: BacklogSettings, field: OptionalField): string {
  return settings[OPTIONAL_PROPERTIES.find(property => property.field === field)!.settingsKey];
}
/** The Deliverable workflow's key: its own, or the requirements state key. */
export const deliverableStateKey = (settings: BacklogSettings) => settings.deliverableStateKey || settings.stateKey;
export const testStateKey = (settings: BacklogSettings) => settings.testStateKey || settings.stateKey;

export function isDoneValue(settings: Pick<BacklogSettings, 'doneValues'>, state: string | null): boolean {
  return state !== null && settings.doneValues.some(value => sameValue(value, state));
}
export function isStartedValue(settings: Pick<BacklogSettings, 'startedStates'>, state: string | null): boolean {
  return state !== null && settings.startedStates.some(value => sameValue(value, state));
}

/** The values a workflow offers: the configured list, else the observed values with a done value appended. */
export function menuValues(configured: string[], doneValues: string[], observed: string[]): string[] {
  if (configured.length > 0) return configured;
  if (observed.some(value => doneValues.some(done => sameValue(done, value)))) return observed;
  return doneValues.length > 0 ? [...observed, doneValues[0]!] : observed;
}

/** The folder a new item of `type` is filed in, or null when the type has none of its own. */
export function folderForType(type: string, settings: BacklogSettings): string | null {
  return byName(settings.typeFolders, type) || null;
}

export type OwnedRole = 'parent' | 'order' | 'type' | 'tags' | OptionalField;
/** Every role and the key it owns, in backlog-view's `ownedProperties` order. */
export function ownedProperties(settings: BacklogSettings): { role: OwnedRole; key: string }[] {
  return [
    { role: 'parent', key: settings.parentKey }, { role: 'order', key: settings.orderKey }, { role: 'type', key: settings.typeKey },
    ...OPTIONAL_PROPERTIES.map(property => ({ role: property.field, key: settings[property.settingsKey] })),
    { role: 'tags', key: settings.tagsKey },
  ];
}

const workflowRoles: readonly OwnedRole[] = ['state', 'deliverableState', 'testState'];
/** Two roles bound to one key block every write; the three workflow-state roles may share a key. */
export function configProblems(settings: BacklogSettings): string[] {
  const keys = new Map<string, OwnedRole[]>();
  for (const { role, key } of ownedProperties(settings)) if (key) keys.set(key, [...(keys.get(key) ?? []), role]);
  const problems: string[] = [];
  for (const [key, roles] of keys) {
    if (roles.length > 1 && !roles.every(role => workflowRoles.includes(role))) problems.push(`The properties ${roles.join(', ')} all use the key "${key}".`);
  }
  return problems;
}
