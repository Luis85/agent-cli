import { ensure } from '../../../domain/shared/errors.ts';
import { backlogError, refused } from '../domain/errors.ts';
import { formatCivil, setOwn, type Frontmatter } from '../domain/fields.ts';
import { vaultFolder } from '../domain/settings-resolve.ts';
import type { BacklogItem } from '../domain/model.ts';
import { ITEM_ID_KEY, newItemFrontmatter, nextItemId, uniqueNotePath } from '../domain/notes.ts';
import { dropPlacement, rankablePeers, spreadAround, unchangedPlacement, type DropTarget, type RankResult } from '../domain/ranks.ts';
import { folderForType, isDoneValue, isStartedValue } from '../domain/settings.ts';
import {
  ABSENCE_TYPE, RELEASE_TYPE, RESOURCE_TYPE, canonicalType, isMarkerType, isReleaseType, keepsProjection, mayHoldField, sameType,
} from '../domain/vocabulary.ts';
import { announce, createNotes, ensureWritable, newNoteText, writeItems, type WriteResult } from './writer.ts';
import { findItem, pathTaken, typeOf, wikilink, type BacklogSession } from './session.ts';

const rankMessages = {
  gapSpent: 'No rank gap is left between the neighbours; run backlog ranks respace.',
  tied: 'The neighbours share one rank; run backlog ranks respace.',
  unranked: 'A neighbour has no rank; run backlog ranks seed.',
} as const;

function placed(result: RankResult): number {
  if ('refusal' in result) throw backlogError('BACKLOG_NO_GAP', rankMessages[result.refusal], { reason: result.refusal });
  return result.order;
}

/** The rank at the end of a sibling group (backlog-view's `newItemOrder`). */
function endOfSiblings(session: BacklogSession, parent: BacklogItem | null): number {
  const peers = rankablePeers(parent ? parent.children : session.model.roots);
  return placed(dropPlacement<BacklogItem>(null, { parent, peers, insertIndex: peers.length }, session.model.ranked));
}

function ensureResult(item: BacklogItem, role: string): void {
  if (item.outsideFilter) throw refused('outside-filter', `${item.path} is a context row outside the filter and cannot be ${role}.`, { path: item.path });
}

/** The folder a new item goes to: beside its parent in folder mode, else its type folder, the home folder, or the most used folder. */
function folderFor(session: BacklogSession, type: string, parent: BacklogItem | null, explicit?: string): string {
  if (explicit !== undefined) return vaultFolder(explicit);
  if (session.settings.folderHierarchy && parent && !parent.outsideFilter) return parent.path.includes('/') ? parent.path.slice(0, parent.path.lastIndexOf('/')) : '';
  const chosen = folderForType(type, session.settings) || session.settings.homeFolder;
  if (chosen) return chosen;
  const counts = new Map<string, number>();
  for (const item of session.model.items) if (!item.outsideFilter) { const folder = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : ''; counts.set(folder, (counts.get(folder) ?? 0) + 1); }
  return [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best), ['', 0])[0];
}

export interface AddRequest {
  type: string; title: string; parent?: string; folder?: string; state?: string;
  iteration?: string; release?: string; assignee?: string; tags?: string[];
}

/**
 * `backlog add`: backlog-view's `createBacklogItem` (sanitized unique name, `pbl-id`, key order, end-of-siblings
 * rank, iteration dates) plus the optional state, assignee and tags a later edit would append.
 */
export async function addItem(session: BacklogSession, request: AddRequest): Promise<WriteResult & { item: Record<string, unknown> }> {
  ensureWritable(session);
  const { settings } = session;
  const typeName = canonicalType(request.type.trim());
  if ([RESOURCE_TYPE, ABSENCE_TYPE].some(type => sameType(typeName, type))) throw refused('reserved-type', `${typeName} notes are not backlog items.`, { type: typeName });
  if (isReleaseType(typeName)) throw refused('use-release-add', 'Create releases with backlog release add.', { type: RELEASE_TYPE });
  const parent = request.parent === undefined ? null : findItem(session, request.parent);
  if (parent && isMarkerType(parent.typeName)) throw refused('marker', `${parent.title} is a ${parent.typeName}; markers take no children.`, { parent: parent.path });
  const order = endOfSiblings(session, parent);
  const folder = folderFor(session, typeName, parent, request.folder);
  const path = uniqueNotePath(folder, request.title, candidate => pathTaken(session, candidate));
  const link = (target: string) => wikilink(session, target, path);
  const iteration = request.iteration === undefined ? undefined : findItem(session, request.iteration);
  if (iteration && !sameType(iteration.typeName, 'Iteration')) throw refused('not-an-iteration', `${iteration.title} is not an Iteration.`, { iteration: iteration.path });
  const release = request.release === undefined ? undefined : findItem(session, request.release);
  if (release) {
    if (!settings.releaseKey) throw refused('unbound-property', 'Bind releaseProperty in the backlog view to link releases.', { option: 'releaseProperty' });
    if (!isReleaseType(release.typeName)) throw refused('not-a-release', `${release.title} is not a Release.`, { release: release.path });
    if (!mayHoldField(typeName, 'release', settings.iterationBars)) throw refused('field-not-held', `A ${typeName} may not join a release.`, { type: typeName });
  }
  if (iteration && !settings.iterationKey) throw refused('unbound-property', 'Bind iterationProperty in the backlog view to plan iterations.', { option: 'iterationProperty' });
  const axis = iteration ? Object.fromEntries((['start', 'target'] as const).flatMap(end => {
    const date = (end === 'start' ? iteration.plannedStart : iteration.plannedTarget).value;
    return date === null ? [] : [[end, formatCivil(date)]];
  })) : undefined;
  const frontmatter = newItemFrontmatter(settings, {
    id: nextItemId(session.cache.files().map(file => session.cache.getFileCache(file)?.frontmatter)), typeName, order,
    parentLink: parent ? link(parent.path) : null, ...(iteration ? { iterationLink: link(iteration.path), axis } : {}), ...(release ? { releaseLink: link(release.path) } : {}),
  });
  appendFields(session, frontmatter, path, request);
  const result = await createNotes(session, [{ path, text: newNoteText(session, frontmatter) }]);
  const item = { path, title: path.slice(path.lastIndexOf('/') + 1, -3), type: typeName, id: frontmatter[ITEM_ID_KEY], parent: parent?.path ?? null, order };
  await announce(session, result, 'backlog.item-created', item);
  return { ...result, item };
}

/** State (with the start/finish stamps), assignee and tags, appended in the order later edits would add them. */
function appendFields(session: BacklogSession, frontmatter: Frontmatter, path: string, request: AddRequest): void {
  const { settings } = session;
  if (request.state !== undefined) {
    if (!settings.stateKey) throw refused('unbound-property', 'Bind stateProperty in the backlog view to track states.', { option: 'stateProperty' });
    setOwn(frontmatter, settings.stateKey, request.state);
    if (settings.startedDateKey && isStartedValue(settings, request.state)) setOwn(frontmatter, settings.startedDateKey, formatCivil(session.today));
    if (settings.finishedDateKey && isDoneValue(settings, request.state)) setOwn(frontmatter, settings.finishedDateKey, formatCivil(session.today));
  }
  if (request.assignee !== undefined) {
    if (!settings.assigneeKey) throw refused('unbound-property', 'Bind assigneeProperty in the backlog view to assign work.', { option: 'assigneeProperty' });
    const target = session.cache.getFirstLinkpathDest(request.assignee, session.base.path);
    if (target === null || !sameType(typeOf(session, target), RESOURCE_TYPE)) throw refused('not-a-resource', `${request.assignee} is not a Resource note.`, { assignee: request.assignee });
    setOwn(frontmatter, settings.assigneeKey, wikilink(session, target, path));
  }
  if (request.tags && request.tags.length > 0 && settings.tagsKey) setOwn(frontmatter, settings.tagsKey, request.tags);
}

export interface MoveRequest { item: string; parent?: string; top?: boolean; before?: string; after?: string; first?: boolean; last?: boolean; ifMatch?: string }

/** The drop target a move names; without a position the item goes last among its (new) siblings. */
function moveTarget(session: BacklogSession, moved: BacklogItem, request: MoveRequest): DropTarget<BacklogItem> {
  const anchorRef = request.before ?? request.after;
  if (anchorRef !== undefined) {
    const anchor = findItem(session, anchorRef);
    ensureResult(anchor, 'a move anchor');
    ensure(anchor !== moved, 'INVALID_ARGUMENT', 'An item cannot be placed before or after itself.');
    if (request.parent !== undefined || request.top) {
      const wanted = request.top ? null : findItem(session, request.parent!);
      if (anchor.parent !== wanted) throw refused('projection', `${anchor.title} is not a child of the requested parent.`, { anchor: anchor.path });
    }
    const peers = rankablePeers(anchor.parent ? anchor.parent.children : session.model.roots).filter(peer => peer !== moved);
    const index = peers.indexOf(anchor);
    return { parent: anchor.parent, peers, insertIndex: request.before !== undefined ? index : index + 1 };
  }
  const parent = request.top ? null : request.parent !== undefined ? findItem(session, request.parent) : moved.parent;
  const peers = rankablePeers(parent ? parent.children : session.model.roots).filter(peer => peer !== moved);
  return { parent, peers, insertIndex: request.first ? 0 : peers.length };
}

/** `backlog move`: rank arithmetic between the new neighbours; writes only the moved note's parent and order. */
export async function moveItem(session: BacklogSession, request: MoveRequest): Promise<WriteResult & { item: Record<string, unknown> }> {
  ensureWritable(session);
  const moved = findItem(session, request.item);
  ensureResult(moved, 'moved');
  const target = moveTarget(session, moved, request);
  for (let ancestor = target.parent; ancestor !== null; ancestor = ancestor.parent) {
    if (ancestor === moved) throw refused('parent-cycle', `${moved.title} cannot move under itself or its descendants.`, { path: moved.path });
  }
  if (!keepsProjection(moved, target.parent)) throw refused('projection', `${moved.title} cannot move between the plan and the test catalog.`, { path: moved.path });
  const newParent = target.parent?.path ?? null, oldParent = moved.parent?.path ?? null;
  if (unchangedPlacement(moved, target, moved.parent ? moved.parent.children : session.model.roots)) {
    return { dryRun: session.context.workspace.dryRun, changes: [], item: { path: moved.path, parent: oldParent, order: moved.order, previousParent: oldParent, previousOrder: moved.order } };
  }
  const order = placed(dropPlacement(moved, target, session.model.ranked));
  const parentChanged = newParent !== oldParent || (target.parent === null && moved.parent === null && moved.hasParentValue);
  const result = await writeItems(session, [{ path: moved.path, order, ...(parentChanged ? { parent: newParent } : {}) }], request.ifMatch);
  const item = { path: moved.path, parent: newParent, order, previousParent: oldParent, previousOrder: moved.order };
  await announce(session, result, 'backlog.item-moved', item);
  return { ...result, item };
}

/** `backlog ranks seed|respace`: 1000, 2000… in tree preorder or current rank order, around fixed context ranks. */
export async function respaceRanks(session: BacklogSession, mode: 'seed' | 'respace'): Promise<WriteResult & { ranked: number }> {
  ensureWritable(session);
  const sequence: BacklogItem[] = [];
  if (mode === 'seed') { const visit = (items: BacklogItem[]) => { for (const item of items) { sequence.push(item); visit(item.children); } }; visit(session.model.roots); }
  else sequence.push(...session.model.ranked);
  const spread = spreadAround(sequence);
  if ('wedged' in spread) throw backlogError('BACKLOG_NO_GAP', `${spread.wedged.length} items no longer fit between the ranks of their context rows.`, { reason: 'gapSpent', paths: spread.wedged.map(item => item.path) });
  const writes = spread.writes.filter(({ item, order }) => item.order !== order).map(({ item, order }) => ({ path: item.path, order }));
  return { ...(await writeItems(session, writes)), ranked: spread.writes.length };
}
