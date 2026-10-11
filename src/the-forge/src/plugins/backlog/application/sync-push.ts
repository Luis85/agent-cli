import type { BoundConnection } from '../../../application/connectors/contract.ts';
import type { RemoteDraft, RemoteItem, RemotePatch } from '../../../domain/connectors/items.ts';
import { isRecord } from '../../../domain/shared/errors.ts';
import { backlogError } from '../domain/errors.ts';
import { canonical, sortedIds, type FieldKey } from '../domain/sync-fields.ts';
import { UNSETTLED_REV } from '../domain/sync-state.ts';
import type { SyncStore } from './sync-store.ts';
import { nextBase, settlePush, type ItemPlan } from './sync-plan.ts';
import { localValues, remoteChange, remoteValues, type ValueContext, type Values } from './sync-values.ts';
import type { ViewReport, ViewSyncOptions } from './sync.ts';

/** The id of a note that a planned create is still to give an id: `new:<path>`. */
export const PLACEHOLDER = 'new:';
const DEPENDENCIES = 'dependencies';
const codeOf = (error: unknown) => (isRecord(error) && typeof error.code === 'string' ? error.code : 'OPERATION_FAILED');
const isStale = (error: unknown) => isRecord(error) && isRecord(error.details) && error.details.reason === 'stale-revision';
const sameValues = (a: Values, b: Values) => a.size === b.size && [...a].every(([field, value]) => b.has(field) && canonical(field, value) === canonical(field, b.get(field)!));

/** What the remote writes left for the vault side: fields pushed per note, and notes whose link update failed. */
export interface PushOutcome { pushed: Map<string, Set<FieldKey>>; linkFailed: Set<string> }
interface Run { context: ValueContext; bound: BoundConnection; report: ViewReport; options: ViewSyncOptions; store: SyncStore; hash: (text: string) => string }

/**
 * Remote writes, planned first: creates in tree preorder so parents exist before their children (a child's parent
 * placeholder resolves to the id just created), then updates guarded by the remote revision. Dependency links follow
 * in a second phase once every create of the run has its id, so a note may depend on a note created in the same run
 * in any order. Dry runs and status only report them. Each created item is recorded in the state file right after
 * its create, so no later failure can lose its id and make a retry create it twice. A refused token stops all
 * further requests and aborts the sync after that record; any other failure is reported per note.
 */
export async function pushAll(context: ValueContext, bound: BoundConnection, plans: ItemPlan[], ids: Map<string, string>, report: ViewReport, options: ViewSyncOptions, live: boolean, store: SyncStore, hash: (text: string) => string): Promise<PushOutcome> {
  const run: Run = { context, bound, report, options, store, hash };
  const outcome: PushOutcome = { pushed: new Map(), linkFailed: new Set() };
  const resolve = (value: string): string | undefined => {
    if (!value.startsWith(PLACEHOLDER)) return value;
    const id = ids.get(value.slice(PLACEHOLDER.length));
    return id === undefined || id.startsWith(PLACEHOLDER) ? undefined : id;
  };
  const links: Array<{ plan: ItemPlan; wanted: string[] }> = [];
  for (const plan of plans) {
    if (plan.create && options.direction === 'pull') { report.skipped.push({ path: plan.path, code: 'not-created', reason: 'not synced yet; a push creates it' }); continue; }
    const values = plan.create ? new Map([...plan.local].filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0))) : plan.push;
    if (values.size === 0) continue;
    if (!live) { (plan.create ? report.created : report.updated).push({ path: plan.path, remoteId: plan.id, url: plan.url, fields: [...values.keys()] }); continue; }
    options.checkpoint?.();
    const wanted = values.get(DEPENDENCIES) as string[] | undefined;
    const first = new Map([...values].filter(([field]) => field !== DEPENDENCIES));
    const change = remoteChange(context, first) as RemotePatch;
    if (typeof change.parentId === 'string') { const parent = resolve(change.parentId); if (parent === undefined) delete change.parentId; else change.parentId = parent; }
    let result = plan.remote;
    if (plan.create || first.size > 0) {
      try {
        result = plan.create
          ? await bound.connector.create(bound.connection, { ...change, type: String(plan.local.get('type')), title: String(plan.local.get('title') ?? plan.item.title) } as RemoteDraft)
          : await guardedUpdate(run, plan, change);
      } catch (error) { fail(run, plan, error); continue; }
      if (plan.create) ids.set(plan.path, result.id);
      // The links land in the second phase: until then the note's dependencies are not pushed.
      const held = plan.push.get(DEPENDENCIES);
      plan.push.delete(DEPENDENCIES);
      settlePush(context, plan, result, options.direction, plan.create ? resolvedLocal(context, plan) : plan.local);
      if (held !== undefined) plan.push.set(DEPENDENCIES, held);
      (plan.create ? report.created : report.updated).push({ path: plan.path, remoteId: result.id, url: result.url, fields: [...first.keys()] });
    }
    outcome.pushed.set(plan.path, new Set(first.keys()));
    if (plan.create) await record(run, plan);
    if (wanted !== undefined) links.push({ plan, wanted });
  }
  for (const { plan, wanted } of links) {
    const resolved = wanted.map(resolve);
    if (resolved.some(id => id === undefined)) {
      plan.skipped.push({ path: plan.path, field: DEPENDENCIES, code: 'unsynced-dependency', reason: 'a predecessor was not created in this run; the links follow on the next sync' });
      continue;
    }
    options.checkpoint?.();
    let result: RemoteItem;
    try { result = await guardedUpdate(run, plan, { dependencies: resolved as string[] }); }
    catch (error) { fail(run, plan, error); outcome.linkFailed.add(plan.path); continue; }
    settleLinks(context, plan, result, resolved as string[]);
    outcome.pushed.get(plan.path)!.add(DEPENDENCIES);
    const entry = [...report.created, ...report.updated].find(operation => operation.path === plan.path);
    if (entry) entry.fields.push(DEPENDENCIES); else report.updated.push({ path: plan.path, remoteId: result.id, url: result.url, fields: [DEPENDENCIES] });
    if (plan.create) await record(run, plan);
  }
  return outcome;
}

/**
 * A revision-guarded update. When the remote revision moved but no synced value changed (a link added on another
 * item revises this one too), the item is read again and the update repeated once at the fresh revision; any real
 * remote change stays a stale-revision failure.
 */
async function guardedUpdate({ context, bound: { connection, connector } }: Run, plan: ItemPlan, change: RemotePatch): Promise<RemoteItem> {
  try { return await connector.update(connection, plan.id!, change, plan.remote!.rev); }
  catch (error) {
    if (!isStale(error)) throw error;
    const [fresh] = await connector.query(connection, [plan.id!]);
    if (fresh === undefined || !sameValues(plan.remoteValues, remoteValues(context, fresh))) throw error;
    return connector.update(connection, plan.id!, change, fresh.rev);
  }
}

function fail({ report, options }: Run, plan: ItemPlan, error: unknown): void {
  if (codeOf(error) === 'CONNECTOR_AUTH_FAILED') throw error;
  const stale = isStale(error);
  if (stale && options.resolution) throw backlogError('SYNC_CONFLICT', `${plan.path}: the remote item changed while resolving; run backlog sync status and resolve again.`, { path: plan.path, remoteId: plan.id });
  report.failed.push({ path: plan.path, remoteId: plan.id, code: stale ? 'SYNC_CONFLICT' : codeOf(error), message: stale ? 'The remote item changed during the sync; run the sync again.' : String((error as Error).message) });
}

/** Records a created item (and, after its links landed, their base) in the state file right away. */
async function record({ store, hash }: Run, plan: ItemPlan): Promise<void> {
  store.set(plan.path, { id: plan.id!, url: plan.url!, rev: plan.remoteChanged.length === 0 ? plan.remote!.rev : UNSETTLED_REV, fields: nextBase(plan, new Set(), new Set(), hash) });
  await store.save();
}

/** A created note's values once its parent's id is known; a parent that could not be created is left out, and links follow later. */
function resolvedLocal(context: ValueContext, plan: ItemPlan): Values {
  const values = localValues(context, plan.item, plan.frontmatter, plan.body);
  const parent = values.get('parent');
  if (typeof parent === 'string' && parent.startsWith(PLACEHOLDER)) values.delete('parent');
  const links = values.get(DEPENDENCIES);
  if (Array.isArray(links) && links.length > 0) values.delete(DEPENDENCIES);
  return values;
}

/**
 * Takes in the item a link update returned: the note's dependencies now hold real ids, a link the platform stored
 * differently is reported (`server-kept`), and any other field it changed meanwhile is compared again next time.
 */
function settleLinks(context: ValueContext, plan: ItemPlan, result: RemoteItem, resolved: string[]): void {
  const before = plan.remoteValues;
  Object.assign(plan, { remote: result, remoteValues: remoteValues(context, result) });
  for (const [field, value] of plan.remoteValues) {
    if (field !== DEPENDENCIES && before.has(field) && canonical(field, before.get(field)!) !== canonical(field, value)) plan.remoteChanged.push(field);
  }
  plan.local.set(DEPENDENCIES, sortedIds(resolved));
  const stored = plan.remoteValues.get(DEPENDENCIES);
  if (stored !== undefined && canonical(DEPENDENCIES, stored) !== canonical(DEPENDENCIES, resolved)) {
    plan.baseFrom.set(DEPENDENCIES, 'remote');
    plan.skipped.push({ path: plan.path, field: DEPENDENCIES, code: 'server-kept', reason: `the platform stored ${canonical(DEPENDENCIES, stored)} instead of ${canonical(DEPENDENCIES, resolved)}; the next sync pushes the note's value again` });
  }
}
