import type { ConnectorHub } from '../../../application/connectors/contract.ts';
import type { ReleaseLock } from '../../../application/plugins/core-plugins.ts';
import type { CommandContext } from '../../../application/plugins/registry.ts';
import { AppError } from '../../../domain/shared/errors.ts';
import { backlogError } from '../domain/errors.ts';
import type { CivilDate } from '../domain/fields.ts';
import { lockPath } from '../domain/sync-state.ts';
import { BACKLOG_VIEW, discover, findItem, isBound, openBacklog, readBase, type BacklogPorts, type BacklogSession, type BaseFile, type BasesQueryService } from './session.ts';
import type { Direction } from './sync-plan.ts';
import { SyncStore, type SyncActivity } from './sync-store.ts';
import { publish, syncView, type SyncMode, type ViewReport } from './sync.ts';

export interface SyncRequest {
  base?: string; view?: string; direction: Direction; mode: SyncMode; today?: CivilDate;
  /** `backlog sync resolve <item> --take local|remote [--field a,b]`. */
  resolve?: { item: string; take: 'local' | 'remote'; fields: string[] | null };
}
export interface SyncServices {
  bases: BasesQueryService; ports: BacklogPorts; hub: ConnectorHub; activity: SyncActivity;
  /** Lock files in the command scope (`.forge/sync/<connection>.lock`). */
  lock(path: string, command: string): Promise<ReleaseLock>;
}
interface BoundView { base: string; view: string; connection: string }
/** A note that left the sync set of its connection: its state entry is kept, the remote item is never deleted. */
interface Left { connection: string; path: string; remoteId: string; url: string }

/** Every product-backlog view with a `connection` option, in base path and view order; `--base`/`--view` narrow it. */
async function boundViews(context: CommandContext, request: Pick<SyncRequest, 'base' | 'view'>): Promise<BoundView[]> {
  let bases: BaseFile[];
  if (request.base === undefined) bases = await discover(context, await context.metadata.load());
  else {
    try { bases = [await readBase(context, request.base)]; }
    catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') throw backlogError('BACKLOG_NOT_FOUND', `The base ${request.base} does not exist.`, { base: request.base });
      throw error;
    }
  }
  const views = bases.flatMap(base => base.views.filter(view => view.type === BACKLOG_VIEW && (request.view === undefined || view.name === request.view))
    .map(view => ({ base: base.path, view: view.name, connection: isBound(view) ? String(view.options.connection).trim() : null })));
  const bound = views.filter((entry): entry is BoundView => entry.connection !== null);
  if (bound.length === 0) {
    const where = request.base === undefined ? 'this scope' : `${request.base}${request.view === undefined ? '' : ` › ${request.view}`}`;
    throw backlogError('BACKLOG_NOT_FOUND', `No product-backlog view in ${where} is bound to a connection; add the view option connection: <id>.`, { views: views.map(({ base, view }) => ({ base, view })) });
  }
  return bound;
}

const totals = (views: readonly ViewReport[], left: readonly Left[]) => ({
  created: views.reduce((sum, view) => sum + view.created.length, 0), updated: views.reduce((sum, view) => sum + view.updated.length, 0),
  pulled: views.reduce((sum, view) => sum + view.pulled.length, 0), conflicts: views.reduce((sum, view) => sum + view.conflicts.length, 0),
  skipped: views.reduce((sum, view) => sum + view.skipped.length, 0), left: left.length,
  failed: views.reduce((sum, view) => sum + view.failed.length, 0),
});

/**
 * `backlog sync`, `backlog sync status` and `backlog sync resolve`. Each bound view syncs with its own connection,
 * so views of one repository can sync to different organizations and projects. Status reads both sides and writes
 * nothing; a dry run additionally plans the vault writes and returns their diffs. A live run holds the lock file
 * of every connection it syncs from start to end, so two syncs of one connection never interleave.
 */
export async function runSync(context: CommandContext, services: SyncServices, request: SyncRequest) {
  const views = await boundViews(context, request);
  const live = request.mode === 'sync' && !context.workspace.dryRun;
  const open = (view: BoundView) => openBacklog(context, services.bases, services.ports, { base: view.base, view: view.view, ...(request.today ? { today: request.today } : {}) });
  let targets = views;
  let resolution: { path: string; take: 'local' | 'remote'; fields: string[] | null } | undefined;
  if (request.resolve) {
    const holding = [];
    for (const view of views) {
      try { holding.push({ view, path: findItem(await open(view), request.resolve.item).path }); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'BACKLOG_NOT_FOUND')) throw error; }
    }
    if (holding.length === 0) throw backlogError('BACKLOG_NOT_FOUND', `${request.resolve.item} is not an item of a bound view.`, { reference: request.resolve.item });
    if (holding.length > 1) throw backlogError('BACKLOG_AMBIGUOUS', `${request.resolve.item} syncs in ${holding.length} views; pass --base and --view.`, { candidates: holding.map(entry => ({ base: entry.view.base, view: entry.view.view, connection: entry.view.connection })) });
    targets = [holding[0]!.view];
    resolution = { path: holding[0]!.path, take: request.resolve.take, fields: request.resolve.fields };
  }
  const connections = [...new Set(targets.map(view => view.connection))];
  const bound = new Map(connections.map(id => [id, services.hub.connection(id)]));
  const releases: ReleaseLock[] = [];
  const reports: ViewReport[] = [];
  let left: Left[] = [];
  services.activity.syncing = true;
  try {
    if (live) for (const id of [...connections].sort()) releases.push(await services.lock(lockPath(id), 'backlog sync'));
    const stores = new Map<string, SyncStore>();
    for (const id of connections) stores.set(id, await SyncStore.open(context.workspace, id));
    const all = request.base === undefined && request.view === undefined ? views : [...views, ...await boundViews(context, {})];
    const held = resolution ? null : await heldPaths(all, connections, open);
    const leftOf = (connection: string) => (held === null ? [] : leftEntries(connection, stores.get(connection)!, held.get(connection)!));
    for (const view of targets) {
      const session = await open(view);
      const connection = bound.get(view.connection)!;
      const { report } = await syncView(session, connection, stores.get(view.connection)!, services.ports.hash, { mode: request.mode, direction: resolution ? 'both' : request.direction, ...(resolution ? { resolution } : {}) });
      for (const entry of report.pulled) if (entry.renamedTo) held?.get(view.connection)!.add(entry.renamedTo);
      reports.push(report);
      if (live) await publish(session, services.hub, connection, report, leftOf(view.connection).length);
    }
    left = connections.flatMap(leftOf);
  } finally {
    services.activity.syncing = false;
    for (const release of releases.reverse()) if (!(await release())) context.events.warn('A backlog sync lock no longer carried this run\'s token and was left in place; inspect .forge/sync for concurrent syncs.');
  }
  return {
    dryRun: request.mode === 'status' || context.workspace.dryRun, mode: request.resolve ? 'resolve' : request.mode, direction: request.resolve ? 'both' : request.direction,
    counts: totals(reports, left), views: reports, left, changes: reports.flatMap(report => report.changes),
  };
}

/** The note paths each connection's bound views hold, across all bound views of the scope (not only the ones this run syncs). */
async function heldPaths(all: readonly BoundView[], connections: readonly string[], open: (view: BoundView) => Promise<BacklogSession>): Promise<Map<string, Set<string>>> {
  const held = new Map(connections.map(id => [id, new Set<string>()]));
  for (const view of all) {
    const paths = held.get(view.connection);
    if (paths) for (const item of (await open(view)).model.results) paths.add(item.path);
  }
  return held;
}

/** The state entries of a connection whose note no bound view of that connection holds any more. */
function leftEntries(connection: string, store: SyncStore, held: ReadonlySet<string>): Left[] {
  return Object.entries(store.state.items).filter(([path]) => !held.has(path)).map(([path, entry]) => ({ connection, path, remoteId: entry.id, url: entry.url }));
}
