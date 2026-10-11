import {
  absent, linkpathFromRawValue, ownValue, readDate, readNumber, readPlacement, readSoleDate, readString, readTags,
  type CivilDate, type FieldReading, type Frontmatter,
} from './fields.ts';
import type { LinkEntry } from './dependencies.ts';
import { OPTIONAL_PROPERTIES, deliverableStateKey, testStateKey, type BacklogSettings, type OptionalField } from './settings.ts';
import { isAbsenceType, isMarkerType, isReleaseType, isResourceType } from './vocabulary.ts';

/** A frontmatter link as the metadata cache records it: the dotted key (`dependsOn.0`) and the link text. */
export interface FrontmatterLink { key: string; link: string }

/**
 * What the model reads of the vault: frontmatter and frontmatter links from the metadata cache, and link
 * resolution with Obsidian's `getFirstLinkpathDest` semantics. `frontmatter` is undefined for a note without a
 * cache entry. Paths are root-relative vault paths.
 */
export interface NoteSource {
  frontmatter(path: string): Frontmatter | undefined;
  frontmatterLinks(path: string): readonly FrontmatterLink[];
  resolve(linkpath: string, sourcePath: string): string | null;
}

interface ParentRef { path: string | null; hasValue: boolean; explicitRoot: boolean }

/** backlog-view's `resolveParent`: the first frontmatter link of the parent key, else a bare name; `''` is an explicit root. */
function resolveParent(source: NoteSource, path: string, parentKey: string): ParentRef {
  const frontmatter = source.frontmatter(path);
  if (frontmatter === undefined) return { path: null, hasValue: false, explicitRoot: false };
  const link = source.frontmatterLinks(path).find(entry => entry.key === parentKey || entry.key.startsWith(`${parentKey}.`));
  if (link) return { path: source.resolve(link.link.split('#')[0]!, path), hasValue: true, explicitRoot: false };
  const raw = ownValue(frontmatter, parentKey);
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim().length === 0) return { path: null, hasValue: false, explicitRoot: raw !== undefined };
  const linkpath = linkpathFromRawValue(value);
  if (linkpath.length === 0) return { path: null, hasValue: true, explicitRoot: false };
  return { path: source.resolve(linkpath, path), hasValue: true, explicitRoot: false };
}

/** Every text entry of a link list key, resolved; non-text and empty entries are skipped. */
function readLinkList(source: NoteSource, path: string, key: string): LinkEntry[] {
  const frontmatter = source.frontmatter(path);
  if (frontmatter === undefined || key === '') return [];
  const raw = ownValue(frontmatter, key);
  if (raw === undefined) return [];
  const linked = new Map<string, string>();
  for (const link of source.frontmatterLinks(path)) if (link.key === key || link.key.startsWith(`${key}.`)) linked.set(link.key, link.link);
  const entries: LinkEntry[] = [];
  (Array.isArray(raw) ? raw : [raw]).forEach((value: unknown, index) => {
    if (typeof value !== 'string' || value.trim().length === 0) return;
    const text = value.trim();
    const linkpath = (linked.get(Array.isArray(raw) ? `${key}.${index}` : key) ?? linkpathFromRawValue(text)).split('#')[0]!.split('|')[0]!.trim();
    entries.push({ raw: text, path: linkpath.length > 0 ? source.resolve(linkpath, path) : null });
  });
  return entries;
}

/** One note the base returned (or an ancestor loaded as context), read once. */
export interface RawItem {
  path: string; title: string; outsideFilter: boolean; entryIndex: number;
  typeName: string | null; pblId: number | null; order: number | null;
  parentPath: string | null; hasParentValue: boolean; parentExists: boolean; explicitRoot: boolean;
  stateValue: string | null; done: boolean; tags: string[];
  deliverableStateValue: string | null; deliverableDone: boolean; testStateValue: string | null; testDone: boolean;
  horizon: FieldReading<string>; plannedStart: FieldReading<CivilDate>; plannedTarget: FieldReading<CivilDate>;
  riskValue: string | null; priorityValue: string | null; iterationGoalValue: string | null;
  assigneeEntry: LinkEntry | null; iterationEntry: LinkEntry | null; releaseEntry: LinkEntry | null; releaseMultiple: boolean;
  releaseDate: FieldReading<CivilDate>; dependsOnEntries: LinkEntry[];
  ownKeys: Record<OptionalField, boolean>;
}

export interface RawStore { all: RawItem[]; byPath: Map<string, RawItem>; resources: string[]; absences: string[] }

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
const doneIn = (values: string[], state: string | null) => state !== null && values.some(value => value.toLowerCase() === state.toLowerCase());
const gated = <T>(key: string, frontmatter: Frontmatter | undefined, read: (value: unknown) => FieldReading<T>) => (key ? read(ownValue(frontmatter, key)) : absent<T>());
const label = (key: string, frontmatter: Frontmatter | undefined) => (key ? readString(ownValue(frontmatter, key)) : null);

/** The note's folder note ancestor (`a/b/b.md` for `a/b/c.md`), for folder mode. */
export function nearestFolderNote(path: string, exists: (path: string) => boolean): string | null {
  const parentOf = (value: string) => { const slash = value.lastIndexOf('/'); return slash > 0 ? value.slice(0, slash) : null; };
  const noteOf = (folder: string) => `${folder}/${folder.slice(folder.lastIndexOf('/') + 1)}.md`;
  let folder = parentOf(path);
  if (folder !== null && noteOf(folder) === path) folder = parentOf(folder);
  for (; folder !== null; folder = parentOf(folder)) {
    const candidate = noteOf(folder);
    if (candidate !== path && exists(candidate)) return candidate;
  }
  return null;
}

/**
 * backlog-view's `createItems`: every Markdown result in result order, then (with `showOutsideParents`) the
 * ancestors the filter left out as read-only context rows. Resources and absences are set aside.
 */
export function createItems(source: NoteSource, results: readonly string[], settings: BacklogSettings, exists: (path: string) => boolean): RawStore {
  const store: RawStore = { all: [], byPath: new Map(), resources: [], absences: [] };
  const parents: string[] = [];
  const add = (path: string, inFilter: boolean): string | null => {
    const frontmatter = source.frontmatter(path);
    const typeName = readString(ownValue(frontmatter, settings.typeKey));
    if (isAbsenceType(typeName)) { if (inFilter) store.absences.push(path); return null; }
    if (isResourceType(typeName)) { if (inFilter) store.resources.push(path); return null; }
    const parent = resolveParent(source, path, settings.parentKey);
    const seed = parent.path ?? (settings.folderHierarchy && !parent.hasValue && !parent.explicitRoot ? nearestFolderNote(path, exists) : null);
    const state = settings.stateKey ? readString(ownValue(frontmatter, settings.stateKey)) : null;
    const deliverableKey = deliverableStateKey(settings), testKey = testStateKey(settings);
    const deliverableState = deliverableKey ? readString(ownValue(frontmatter, deliverableKey)) : null;
    const testState = testKey ? readString(ownValue(frontmatter, testKey)) : null;
    const release = readLinkList(source, path, settings.releaseKey);
    const releaseRaw = ownValue(frontmatter, settings.releaseKey);
    const id = readNumber(ownValue(frontmatter, 'pbl-id'));
    const item: RawItem = {
      path, title: basename(path), outsideFilter: !inFilter, entryIndex: store.all.length,
      typeName, pblId: id === null ? null : Math.floor(id), order: readNumber(ownValue(frontmatter, settings.orderKey)),
      parentPath: parent.path, hasParentValue: parent.hasValue, parentExists: seed !== null, explicitRoot: parent.explicitRoot,
      stateValue: state, done: doneIn(settings.doneValues, state), tags: settings.tagsKey ? readTags(ownValue(frontmatter, settings.tagsKey)) : [],
      deliverableStateValue: deliverableState, deliverableDone: doneIn(settings.deliverableDoneValues, deliverableState),
      testStateValue: testState, testDone: doneIn(settings.testDoneValues, testState),
      horizon: gated(settings.horizonKey, frontmatter, readPlacement),
      plannedStart: gated(settings.startKey, frontmatter, readDate), plannedTarget: gated(settings.targetKey, frontmatter, readDate),
      riskValue: label(settings.riskKey, frontmatter), priorityValue: label(settings.priorityKey, frontmatter), iterationGoalValue: label(settings.iterationGoalKey, frontmatter),
      assigneeEntry: settings.assigneeKey ? readLinkList(source, path, settings.assigneeKey)[0] ?? null : null,
      iterationEntry: settings.iterationKey ? readLinkList(source, path, settings.iterationKey)[0] ?? null : null,
      releaseEntry: release[0] ?? null, releaseMultiple: Array.isArray(releaseRaw) && releaseRaw.length > 1,
      releaseDate: isReleaseType(typeName) ? gated(settings.releaseDateKey, frontmatter, readSoleDate) : absent(),
      dependsOnEntries: !inFilter || isMarkerType(typeName) ? [] : readLinkList(source, path, settings.dependsOnKey),
      ownKeys: Object.fromEntries(OPTIONAL_PROPERTIES.map(property => [property.field, settings[property.settingsKey] !== '' && ownValue(frontmatter, settings[property.settingsKey]) !== undefined])) as Record<OptionalField, boolean>,
    };
    store.byPath.set(path, item);
    store.all.push(item);
    return seed;
  };
  for (const path of results) {
    if (!path.toLowerCase().endsWith('.md') || store.byPath.has(path)) continue;
    const seed = add(path, true);
    if (seed) parents.push(seed);
  }
  if (settings.showOutsideParents) {
    const queue = [...parents];
    while (queue.length > 0) {
      const path = queue.pop()!;
      if (!path.toLowerCase().endsWith('.md') || store.byPath.has(path) || !exists(path)) continue;
      const next = add(path, false);
      if (next) queue.push(next);
    }
  }
  return store;
}
