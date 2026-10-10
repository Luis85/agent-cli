import { addDays, daysBetween, formatCivil, setOwn, type CivilDate, type Frontmatter } from './fields.ts';
import { normalizePath, vaultFolder } from './settings-resolve.ts';
import { optionalKeyFor, type BacklogSettings } from './settings.ts';
import type { ReleaseSettings } from './settings-resolve.ts';
import { ITERATION_TYPE, RELEASE_TYPE, isIterationType, isReleaseType } from './vocabulary.ts';

/** The fixed id key; its value is the vault's highest numeric `pbl-id` plus one, written only at creation. */
export const ITEM_ID_KEY = 'pbl-id';

/** backlog-view's `sanitizeTitle`: characters a file name cannot hold become `-`; never empty. */
export function sanitizeTitle(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().replace(/^[-\s.]+|[-\s]+$/g, '');
  return cleaned.length > 0 ? cleaned : 'Untitled';
}

/** `<folder>/<sanitized title>.md`, then ` 1`, ` 2`… while the name is taken. */
export function uniqueNotePath(folder: string, title: string, taken: (path: string) => boolean): string {
  const base = sanitizeTitle(title);
  const filePath = (name: string) => (folder ? normalizePath(`${folder}/${name}.md`) : `${name}.md`);
  let path = filePath(base);
  for (let copy = 1; taken(path); copy++) path = filePath(`${base} ${copy}`);
  return path;
}

/** backlog-view's `nextItemId`: the highest numeric `pbl-id` (numbers and numeric strings) plus one. */
export function nextItemId(frontmatters: Iterable<Frontmatter | undefined>): number {
  let highest = 0;
  for (const frontmatter of frontmatters) {
    const raw = frontmatter !== undefined && Object.hasOwn(frontmatter, ITEM_ID_KEY) ? frontmatter[ITEM_ID_KEY] : undefined;
    if (typeof raw !== 'number' && typeof raw !== 'string') continue;
    const value = Math.floor(Number(raw));
    if (value > highest && value < Number.MAX_SAFE_INTEGER) highest = value;
  }
  return highest + 1;
}

/** What `createBacklogItem` receives; link targets are vault paths, already rendered as wikilinks. */
export interface NewItemSpec {
  id: number; typeName: string; order: number;
  parentLink: string | null; iterationLink?: string; releaseLink?: string; iterationGoal?: string;
  axis?: { horizon?: string; start?: string; target?: string };
}

/**
 * The frontmatter of a new item in backlog-view's key order: `pbl-id`, type, parent (or `''` in folder mode),
 * order, goal, iteration, release, then horizon, start and target. Releases are never seeded with a planning
 * link or axis.
 */
export function newItemFrontmatter(settings: BacklogSettings, spec: NewItemSpec): Frontmatter {
  const frontmatter: Frontmatter = {};
  setOwn(frontmatter, ITEM_ID_KEY, spec.id);
  setOwn(frontmatter, settings.typeKey, spec.typeName);
  if (spec.parentLink !== null) setOwn(frontmatter, settings.parentKey, spec.parentLink);
  else if (settings.folderHierarchy) setOwn(frontmatter, settings.parentKey, '');
  setOwn(frontmatter, settings.orderKey, spec.order);
  const seeded = !isReleaseType(spec.typeName);
  if (spec.iterationGoal && settings.iterationGoalKey) setOwn(frontmatter, settings.iterationGoalKey, spec.iterationGoal);
  if (seeded && spec.iterationLink && settings.iterationKey) setOwn(frontmatter, settings.iterationKey, spec.iterationLink);
  if (seeded && spec.releaseLink && settings.releaseKey) setOwn(frontmatter, settings.releaseKey, spec.releaseLink);
  if (seeded) {
    for (const field of ['horizon', 'start', 'target'] as const) {
      const key = optionalKeyFor(settings, field), value = spec.axis?.[field];
      if (key !== '' && value !== undefined) setOwn(frontmatter, key, value);
    }
  }
  return frontmatter;
}

/** `createRelease`: `pbl-id`, type, then version, target date, status and description when stated and bound. */
export function releaseFrontmatter(settings: ReleaseSettings, id: number, spec: { version?: string; targetDate?: string; status?: string; description?: string }): Frontmatter {
  const frontmatter: Frontmatter = {};
  setOwn(frontmatter, ITEM_ID_KEY, id);
  setOwn(frontmatter, settings.typeKey, RELEASE_TYPE);
  const stated = (value: string | undefined): value is string => value !== undefined && value.trim() !== '';
  for (const [value, key] of [[spec.version, settings.versionKey], [spec.targetDate, settings.targetDateKey], [spec.status, settings.statusKey], [spec.description, settings.descriptionKey]] as const) {
    if (stated(value) && key) setOwn(frontmatter, key, value);
  }
  return frontmatter;
}

/** A new note: frontmatter only, `---\n<yaml>---\n`. */
export const noteText = (yaml: string) => `---\n${yaml}---\n`;

// Iterations: `<N> - Iteration[ - <goal>]`, starting the day after the latest iteration's target.
interface IterationLike { title: string; typeName: string | null; outsideFilter: boolean; path: string; plannedStart: { value: CivilDate | null }; plannedTarget: { value: CivilDate | null } }

export function nextIterationName(items: Iterable<IterationLike>): string {
  let highest = 0;
  for (const item of items) {
    if (!isIterationType(item.typeName) || item.outsideFilter) continue;
    const found = /^\s*(\d+)/.exec(item.title);
    if (found && Number(found[1]) > highest) highest = Number(found[1]);
  }
  return `${highest + 1} - ${ITERATION_TYPE}`;
}

export function iterationNoteName(name: string, goal: string): string {
  const tail = goal.trim().slice(0, 60);
  return tail === '' ? name : `${name} - ${tail}`;
}

/** The iteration with the latest target (then latest start, then path). */
export function previousIteration<T extends IterationLike>(items: Iterable<T>): T | null {
  let best: T | null = null;
  for (const item of items) {
    const target = item.plannedTarget.value;
    if (!isIterationType(item.typeName) || target === null) continue;
    if (best === null) { best = item; continue; }
    const byTarget = daysBetween(best.plannedTarget.value!, target);
    const start = item.plannedStart.value, bestStart = best.plannedStart.value;
    const later = byTarget !== 0 ? byTarget > 0
      : start === null || bestStart === null ? bestStart === null && start !== null
        : daysBetween(bestStart, start) !== 0 ? daysBetween(bestStart, start) > 0 : item.path > best.path;
    if (later) best = item;
  }
  return best;
}

export function nextIterationDates(previous: IterationLike | null, today: CivilDate, lengthDays: number): { start: string; target: string } {
  const after = previous?.plannedTarget.value ?? null;
  const start = after === null ? today : addDays(after, 1);
  return { start: formatCivil(start), target: formatCivil(addDays(start, lengthDays - 1)) };
}

/** backlog-view's "Create backlog" scaffold for a folder. */
export function baseFileContent(folder: string): string {
  const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const formulaArg = folder.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return ['filters:', '  and:', `    - ${quote(`file.inFolder("${formulaArg}")`)}`, '    - file.ext == "md"', 'views:', '  - type: product-backlog', '    name: Backlog', `    homeFolder: ${quote(folder)}`, ''].join('\n');
}

/** `<folder>/Product Backlog.base`, then ` 1`, ` 2`… on collision; the folder defaults to `docs`. */
export function basePath(folderInput: string, taken: (path: string) => boolean): { folder: string; path: string } {
  const folder = vaultFolder(folderInput) || 'docs';
  let path = normalizePath(`${folder}/Product Backlog.base`);
  for (let copy = 1; taken(path); copy++) path = normalizePath(`${folder}/Product Backlog ${copy}.base`);
  return { folder, path };
}
