import type { ConnectorHub } from '../../../application/connectors/contract.ts';
import type { CommandContext } from '../../../application/plugins/registry.ts';
import { AppError } from '../../../domain/shared/errors.ts';
import { backlogError } from '../domain/errors.ts';
import type { CivilDate } from '../domain/fields.ts';
import { BACKLOG_VIEW, discover, findItem, isBound, openBacklog, readBase, type BacklogPorts, type BaseFile, type BasesQueryService } from './session.ts';
import type { Direction } from './sync-plan.ts';
import type { SyncActivity } from './sync-store.ts';
import { syncView, type SyncMode, type ViewReport } from './sync.ts';

export interface SyncRequest {
  base?: string; view?: string; direction: Direction; mode: SyncMode; today?: CivilDate;
  /** `backlog sync resolve <item> --take local|remote [--field a,b]`. */
  resolve?: { item: string; take: 'local' | 'remote'; fields: string[] | null };
}
export interface SyncServices { bases: BasesQueryService; ports: BacklogPorts; hub: ConnectorHub; activity: SyncActivity }
interface BoundView { base: string; view: string; connection: string }

/** Every product-backlog view with a `connection` option, in base path and view order; `--base`/`--view` narrow it. */
async function boundViews(context: CommandContext, request: SyncRequest): Promise<BoundView[]> {
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

const totals = (views: readonly ViewReport[]) => ({
  created: views.reduce((sum, view) => sum + view.created.length, 0), updated: views.reduce((sum, view) => sum + view.updated.length, 0),
  pulled: views.reduce((sum, view) => sum + view.pulled.length, 0), conflicts: views.reduce((sum, view) => sum + view.conflicts.length, 0),
  skipped: views.reduce((sum, view) => sum + view.skipped.length, 0), left: views.reduce((sum, view) => sum + view.left.length, 0),
  failed: views.reduce((sum, view) => sum + view.failed.length, 0),
});

/**
 * `backlog sync`, `backlog sync status` and `backlog sync resolve`. Each bound view syncs with its own connection,
 * so views of one repository can sync to different organizations and projects. Status reads both sides and writes
 * nothing; a dry run additionally plans the vault writes and returns their diffs.
 */
export async function runSync(context: CommandContext, services: SyncServices, request: SyncRequest) {
  const views = await boundViews(context, request);
  const reports: ViewReport[] = [];
  services.activity.syncing = true;
  try {
    let targets = views;
    let resolution: { path: string; take: 'local' | 'remote'; fields: string[] | null } | undefined;
    if (request.resolve) {
      const holding = [];
      for (const view of views) {
        const session = await openBacklog(context, services.bases, services.ports, { base: view.base, view: view.view, ...(request.today ? { today: request.today } : {}) });
        try { holding.push({ view, path: findItem(session, request.resolve.item).path }); }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'BACKLOG_NOT_FOUND')) throw error; }
      }
      if (holding.length === 0) throw backlogError('BACKLOG_NOT_FOUND', `${request.resolve.item} is not an item of a bound view.`, { reference: request.resolve.item });
      if (holding.length > 1) throw backlogError('BACKLOG_AMBIGUOUS', `${request.resolve.item} syncs in ${holding.length} views; pass --base and --view.`, { candidates: holding.map(entry => ({ base: entry.view.base, view: entry.view.view, connection: entry.view.connection })) });
      targets = [holding[0]!.view];
      resolution = { path: holding[0]!.path, take: request.resolve.take, fields: request.resolve.fields };
    }
    for (const view of targets) {
      const session = await openBacklog(context, services.bases, services.ports, { base: view.base, view: view.view, ...(request.today ? { today: request.today } : {}) });
      const bound = services.hub.connection(view.connection);
      reports.push(await syncView(session, services.hub, bound, services.ports.hash, { mode: request.mode, direction: resolution ? 'both' : request.direction, ...(resolution ? { resolution } : {}) }));
    }
  } finally { services.activity.syncing = false; }
  return {
    dryRun: request.mode === 'status' || context.workspace.dryRun, mode: request.resolve ? 'resolve' : request.mode, direction: request.resolve ? 'both' : request.direction,
    counts: totals(reports), views: reports, changes: reports.flatMap(report => report.changes),
  };
}
