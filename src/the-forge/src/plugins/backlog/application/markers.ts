import { ensure } from '../../../domain/shared/errors.ts';
import { backlogError, refused } from '../domain/errors.ts';
import { addDays, formatCivil, ownValue, readDate, readSoleDate, readString, reversedSpan, sameValue, setOwn, type CivilDate } from '../domain/fields.ts';
import {
  ITEM_ID_KEY, iterationNoteName, newItemFrontmatter, nextItemId, nextIterationDates, nextIterationName, previousIteration, releaseFrontmatter, uniqueNotePath,
} from '../domain/notes.ts';
import { dropPlacement, rankablePeers } from '../domain/ranks.ts';
import {
  generatedSource, membershipTarget, releaseIndex, releaseNotesContent, releaseNotesPath, releaseNotesSource, releaseReadiness, scopeRows, type ReleaseRow,
} from '../domain/releases.ts';
import { configProblems, folderForType } from '../domain/settings.ts';
import { membershipCollision, releaseNoteProblems, resolveReleaseSettings } from '../domain/settings-resolve.ts';
import { ITERATION_TYPE, RELEASE_TYPE, isReleaseType } from '../domain/vocabulary.ts';
import { findItem, openReleaseModel, pathTaken, type BacklogSession, type BasesQueryService } from './session.ts';
import { announce, createNotes, editNotes, ensureWritable, newNoteText, type WriteResult } from './writer.ts';

const nextId = (session: BacklogSession) => nextItemId(session.cache.files().map(file => session.cache.getFileCache(file)?.frontmatter));
const parseDate = (value: string, option: string) => {
  const date = readDate(value).value;
  ensure(date !== null && value.trim().length > 0, 'INVALID_ARGUMENT', `--${option} must be a date such as 2026-10-01.`);
  return date;
};

/** `backlog iteration add`: `<N> - Iteration[ - goal]`, starting after the latest iteration, `iterationLengthDays` long. */
export async function addIteration(session: BacklogSession, request: { name?: string; goal?: string; start?: string; due?: string; length?: number }): Promise<WriteResult & { item: Record<string, unknown> }> {
  ensureWritable(session);
  const { settings, model } = session;
  const population = [...model.byPath.values()].filter(item => !item.outsideFilter);
  const length = request.length ?? settings.iterationLengthDays;
  const defaults = nextIterationDates(previousIteration(population), session.today, length);
  const start = request.start === undefined ? defaults.start : formatCivil(parseDate(request.start, 'start'));
  const target = request.due !== undefined ? formatCivil(parseDate(request.due, 'due')) : formatCivil(addDays(readDate(start).value!, length - 1));
  if (reversedSpan(readDate(start).value, readDate(target).value)) throw refused('reversed-span', 'The iteration would end before it starts.', { start, target });
  const goal = request.goal?.trim() ?? '';
  const peers = rankablePeers(model.roots);
  const placed = dropPlacement(null, { parent: null, peers, insertIndex: peers.length }, model.ranked);
  if ('refusal' in placed) throw backlogError('BACKLOG_NO_GAP', 'No rank is left at the end of the backlog; run backlog ranks respace.', { reason: placed.refusal });
  const folder = folderForType(ITERATION_TYPE, settings) || settings.homeFolder;
  const path = uniqueNotePath(folder, iterationNoteName(request.name?.trim() || nextIterationName(population), goal), candidate => pathTaken(session, candidate));
  const frontmatter = newItemFrontmatter(settings, {
    id: nextId(session), typeName: ITERATION_TYPE, order: placed.order, parentLink: null,
    axis: { ...(settings.startKey ? { start } : {}), ...(settings.targetKey ? { target } : {}) },
    ...(settings.iterationGoalKey && goal ? { iterationGoal: goal } : {}),
  });
  const result = await createNotes(session, [{ path, text: newNoteText(session, frontmatter) }]);
  const item = { path, title: path.slice(path.lastIndexOf('/') + 1, -3), type: ITERATION_TYPE, id: frontmatter[ITEM_ID_KEY], parent: null, order: placed.order, start, target };
  await announce(session, result, 'backlog.item-created', item);
  return { ...result, item };
}

/** `backlog release add`: backlog-view's `createRelease` in the release view's folder, with the bound release keys. */
export async function addRelease(session: BacklogSession, title: string, spec: { version?: string; targetDate?: string; status?: string; description?: string }): Promise<WriteResult & { item: Record<string, unknown> }> {
  const settings = session.releaseView?.settings ?? resolveReleaseSettings({});
  if (!settings.typeKey) throw backlogError('BACKLOG_CONFIG_PROBLEM', 'The release view binds no type property.', { option: 'typeProperty' });
  const problems = releaseNoteProblems(settings);
  if (problems.length > 0) throw backlogError('BACKLOG_CONFIG_PROBLEM', `Fix the release configuration first: ${problems[0]}`, { problems });
  for (const [value, key, name] of [[spec.version, settings.versionKey, 'versionProperty'], [spec.targetDate, settings.targetDateKey, 'targetDateProperty'], [spec.status, settings.statusKey, 'releaseStatusProperty'], [spec.description, settings.descriptionKey, 'descriptionProperty']] as const) {
    if (value !== undefined && !key) throw refused('unbound-property', `Bind ${name} in the product-release view first.`, { option: name });
  }
  if (spec.targetDate !== undefined) parseDate(spec.targetDate, 'target-date');
  const path = uniqueNotePath(settings.folder, title, candidate => pathTaken(session, candidate));
  const frontmatter = releaseFrontmatter(settings, nextId(session), spec);
  const result = await createNotes(session, [{ path, text: newNoteText(session, frontmatter) }]);
  const item = { path, title: path.slice(path.lastIndexOf('/') + 1, -3), type: RELEASE_TYPE, id: frontmatter[ITEM_ID_KEY] };
  await announce(session, result, 'backlog.item-created', item);
  return { ...result, item };
}

const figureJson = <T>(figure: { value: T | null; invalid: boolean; unconfigured: boolean }, format: (value: T) => unknown = value => value) =>
  (figure.unconfigured ? { unconfigured: true } : figure.invalid ? { invalid: true } : { value: figure.value === null ? null : format(figure.value) });

function rowJson(row: ReleaseRow) {
  const date = (value: CivilDate) => formatCivil(value);
  return {
    path: row.path, name: row.name, version: figureJson(row.version), target: figureJson(row.target, date), status: figureJson(row.status),
    description: figureJson(row.description), released: figureJson(row.released, date), members: figureJson(row.members), done: figureJson(row.done),
    shipped: row.shipped, overdue: row.overdue, daysToTarget: row.daysToTarget, slip: row.slip,
  };
}

/** The release view's model, index and the row for one release. */
async function releaseContext(session: BacklogSession, bases: BasesQueryService, reference?: string) {
  const context = await openReleaseModel(session, bases);
  const index = releaseIndex(session.source, context.model, context.release.settings, context.plan, session.today);
  if (reference === undefined) return { ...context, index, row: null };
  const item = findItem(session, reference, context.model);
  const row = index.rows.find(entry => entry.path === item.path);
  if (row === undefined || !isReleaseType(item.typeName)) throw backlogError('BACKLOG_NOT_FOUND', `${reference} is not a Release of ${session.base.path} › ${context.release.name}.`, { reference });
  return { ...context, index, row };
}

export async function listReleases(session: BacklogSession, bases: BasesQueryService) {
  const { index, release } = await releaseContext(session, bases);
  return { base: session.base.path, view: release.name, releases: index.rows.map(rowJson), unresolved: index.unresolved.map(item => item.path) };
}

function members(session: BacklogSession, context: Awaited<ReturnType<typeof releaseContext>>, path: string) {
  const releasePaths = new Set(context.model.releases.map(release => release.path));
  return scopeRows(context.model, item => membershipTarget(session.source, item, releasePaths, context.release.settings) === path);
}

/** `backlog release readiness`: estimated, blocked and risk criteria over the direct members. Writes nothing. */
export async function readiness(session: BacklogSession, bases: BasesQueryService, reference: string) {
  const context = await releaseContext(session, bases, reference);
  const rows = members(session, context, context.row!.path);
  const result = releaseReadiness(session.source, rows.filter(row => !row.context).map(row => row.item), context.release.settings, context.plan);
  return { release: rowJson(context.row!), ...result, scope: rows.map(row => ({ path: row.item.path, depth: row.depth, context: row.context })) };
}

/** `backlog release mark-released`: status = the transition value and released = today, on the release note only. */
export async function markReleased(session: BacklogSession, bases: BasesQueryService, reference: string, ifMatch?: string): Promise<WriteResult & { release: Record<string, unknown> }> {
  const context = await releaseContext(session, bases, reference);
  const { settings } = context.release, row = context.row!;
  const missing = [['releaseStatusProperty', settings.statusKey === ''], ['releasedStatusValues', settings.releasedValues.length === 0],
    ['releasedTransitionValue', settings.releasedTransition === '' || !settings.releasedValues.some(value => sameValue(value, settings.releasedTransition))],
    ['releasedDateProperty', settings.releasedDateKey === '']].filter(([, gap]) => gap).map(([name]) => name);
  if (missing.length > 0) throw backlogError('BACKLOG_CONFIG_PROBLEM', `Bind ${missing.join(', ')} in the product-release view to mark releases released.`, { missing });
  if (row.status.invalid || row.released.invalid) throw refused('unreadable', `The status or released date of ${row.name} is unreadable.`, { path: row.path });
  if ((row.status.value !== null && settings.releasedValues.some(value => sameValue(value, row.status.value))) || row.released.value !== null) throw refused('already-released', `${row.name} is already released.`, { path: row.path });
  const today = formatCivil(session.today);
  const result = await editNotes(session, [{
    path: row.path,
    edit: frontmatter => {
      if (!isReleaseType(readString(ownValue(frontmatter, settings.typeKey)))) return refused('not-a-release', `${row.path} is no longer a Release.`, { path: row.path });
      if (readSoleDate(ownValue(frontmatter, settings.releasedDateKey)).value !== null) return refused('already-released', `${row.name} is already released.`, { path: row.path });
      setOwn(frontmatter, settings.statusKey, settings.releasedTransition);
      setOwn(frontmatter, settings.releasedDateKey, today);
      return null;
    },
  }], ifMatch);
  const release = { path: row.path, name: row.name, status: settings.releasedTransition, released: today };
  await announce(session, result, 'backlog.released', release);
  return { ...result, release };
}

/** `backlog release notes`: the generated, byte-compatible notes file; a file generated from another source is never replaced. */
export async function releaseNotes(session: BacklogSession, bases: BasesQueryService, reference: string): Promise<WriteResult & { path: string; outcome: string; content: string }> {
  const context = await releaseContext(session, bases, reference);
  const { settings } = context.release, row = context.row!;
  if (settings.notesFolder.trim() === '') throw backlogError('BACKLOG_CONFIG_PROBLEM', 'Bind releaseNotesFolder in the product-release view to generate release notes.', { option: 'releaseNotesFolder' });
  if (settings.membershipKey === '') throw backlogError('BACKLOG_CONFIG_PROBLEM', 'Bind membershipProperty in the product-release view to generate release notes.', { option: 'membershipProperty' });
  const collision = membershipCollision(settings, context.plan);
  const problems = [...configProblems(context.plan), ...releaseNoteProblems(settings), ...(collision ? [collision] : [])];
  if (problems.length > 0) throw backlogError('BACKLOG_CONFIG_PROBLEM', `Fix the release configuration first: ${problems[0]}`, { problems });
  const source = releaseNotesSource(session.base.path, context.release.name, row.path);
  const content = releaseNotesContent(row.name, members(session, context, row.path), source);
  const path = releaseNotesPath(settings.notesFolder, row.name);
  const { workspace } = session.context;
  let existing: { text: string; revision: string } | null = null;
  try { const file = await workspace.files.read(path); existing = { text: new TextDecoder().decode(file.bytes), revision: file.revision }; }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'NOT_FOUND')) throw error; }
  if (existing === null) return { ...(await createNotes(session, [{ path, text: content }])), path, outcome: 'created', content };
  if (existing.text === content) return { dryRun: workspace.dryRun, changes: [], path, outcome: 'unchanged', content };
  const owner = generatedSource(existing.text);
  if (owner !== source) throw refused('foreign-release-notes', `${path} was not generated for this release; it is left unchanged.`, { path, previous: owner });
  const result = await workspace.write([{ path, bytes: new TextEncoder().encode(content), expectedRevision: existing.revision }], { diff: true });
  return { ...result, path, outcome: 'updated', content };
}
