import type { BoundConnection, ConnectorHub } from '../../../application/connectors/contract.ts';
import type { RemoteDraft, RemoteItem, RemotePatch } from '../../../domain/connectors/items.ts';
import type { FileChange, PlannedChange } from '../../../domain/documents/file.ts';
import { forgeError, isRecord } from '../../../domain/shared/errors.ts';
import { backlogError } from '../domain/errors.ts';
import { noteBody } from '../domain/notes.ts';
import { canonical, type FieldKey, type FieldValue } from '../domain/sync-fields.ts';
import { pathOfRemote } from '../domain/sync-state.ts';
import type { BacklogSession } from './session.ts';
import { readState } from './sync-store.ts';
import { identify, planItem, type Direction, type ItemPlan, type Resolution, type Skip } from './sync-plan.ts';
import { remoteChange, type ValueContext, type Values } from './sync-values.ts';
import { commitVault, landings } from './sync-vault.ts';
import { ensureWritable } from './writer.ts';

export type SyncMode = 'sync' | 'status';
export interface ViewSyncOptions { mode: SyncMode; direction: Direction; resolution?: Resolution }
interface Operation { path: string; remoteId: string | null; url: string | null; fields: FieldKey[] }
interface Failure { path: string; remoteId: string | null; code: string; message: string }

/** What one bound view's sync did (or, for dry runs and status, would do). */
export interface ViewReport {
  base: string; view: string; connection: string; platform: string;
  created: Operation[]; updated: Operation[]; pulled: Array<Operation & { renamedTo?: string }>;
  conflicts: Array<{ path: string; remoteId: string | null; url: string | null; fields: Array<{ field: FieldKey; local: unknown; remote: unknown }> }>;
  resolved: Array<{ path: string; take: 'local' | 'remote'; fields: FieldKey[] }>;
  unchanged: number; skipped: Skip[]; left: Array<{ path: string; remoteId: string; url: string }>; failed: Failure[];
  changes: Array<FileChange | PlannedChange>;
}

const PLACEHOLDER = 'new:';
const codeOf = (error: unknown) => (isRecord(error) && typeof error.code === 'string' ? error.code : 'OPERATION_FAILED');
const keys = (values: Values) => [...values.keys()];
/** A field value as reported JSON: its canonical form. */
const shown = (field: FieldKey, value: FieldValue) => JSON.parse(canonical(field, value)) as unknown;

/**
 * Syncs one product-backlog view with its bound connection: identify each member's remote item, read the linked
 * remote items, plan every field three ways, then (unless status or a dry run) create and update remote items
 * parents first and commit the vault side (see `commitVault`). `connector.*` and `backlog.synced` events follow.
 */
export async function syncView(session: BacklogSession, hub: ConnectorHub, bound: BoundConnection, hash: (text: string) => string, options: ViewSyncOptions): Promise<ViewReport> {
  const { connection, connector } = bound;
  const { workspace } = session.context;
  const live = options.mode === 'sync' && !workspace.dryRun;
  if (options.mode === 'sync') ensureWritable(session);
  const mapping = connector.mapping(connection);
  const stored = await readState(workspace, connection.id);
  const ids = new Map<string, string>();
  const context: ValueContext = { session, connection, mapping, idOf: path => ids.get(path) ?? stored.state.items[path]?.id ?? null };
  const sources = await Promise.all(session.model.results.map(async item => ({
    item, frontmatter: session.cache.getFileCache(item.path)?.frontmatter ?? {},
    body: mapping.fields.description === null ? null : noteBody(new TextDecoder().decode((await workspace.files.read(item.path)).bytes)),
  })));
  const { members, skipped, left } = identify(context, sources, stored.state, url => connector.idFromLink(connection, url));
  for (const member of members) ids.set(member.item.path, member.id ?? `${PLACEHOLDER}${member.item.path}`);
  const targets = options.resolution ? members.filter(member => member.item.path === options.resolution!.path) : members;
  const linked = targets.flatMap(member => (member.id === null ? [] : [member.id]));
  const remotes = new Map((linked.length > 0 ? await connector.query(connection, { ids: linked }) : []).map(item => [item.id, item]));
  const report: ViewReport = {
    base: session.base.path, view: session.view.name, connection: connection.id, platform: connection.platform,
    created: [], updated: [], pulled: [], conflicts: [], resolved: [], unchanged: 0, skipped, left: options.resolution ? [] : left, failed: [], changes: [],
  };
  const plans: ItemPlan[] = [];
  for (const member of targets) {
    const plan = planItem(context, member, member.id === null ? null : remotes.get(member.id) ?? null, { direction: options.direction, hash, ...(options.resolution ? { resolution: options.resolution } : {}) });
    if ('reason' in plan) report.skipped.push(plan); else plans.push(plan);
  }
  if (options.resolution) ensureResolvable(plans, options.resolution);
  const pushed = await pushAll(context, bound, plans, ids, report, options, live);
  const failed = new Set(report.failed.map(failure => failure.path));
  const settled = plans.filter(plan => !failed.has(plan.path) && !(plan.create && options.direction === 'pull'));
  for (const plan of plans) {
    if (plan.conflicts.length > 0) report.conflicts.push({ path: plan.path, remoteId: plan.id, url: plan.url, fields: plan.conflicts.map(({ field, local, remote }) => ({ field, local: shown(field, local), remote: shown(field, remote) })) });
    if (options.resolution && plan.resolved.length > 0) report.resolved.push({ path: plan.path, take: options.resolution.take, fields: plan.resolved });
  }
  report.unchanged = plans.filter(plan => !plan.create && plan.push.size + plan.pull.size + plan.conflicts.length === 0).length;
  const remotePath = (id: string) => [...ids].find(([, value]) => value === id)?.[0] ?? pathOfRemote(stored.state, id);
  const landed = landings(session, context, settled, remotePath);
  for (const { plan, pulled, renameTo, skipped: skips } of landed) {
    report.skipped.push(...skips);
    if (pulled.size > 0) report.pulled.push({ path: plan.path, remoteId: plan.id, url: plan.url, fields: [...pulled], ...(renameTo ? { renamedTo: renameTo } : {}) });
  }
  if (options.mode === 'status') return report;
  report.changes = await commitVault(session, context, landed, stored, pushed, hash, live, report.created.length > 0);
  if (live) await publish(session, hub, bound, report);
  return report;
}

/**
 * Remote writes, planned first: creates in tree preorder so parents exist before their children (a child's parent
 * placeholder resolves to the id just created), then updates guarded by the remote revision. Dry runs and status
 * only report them. A refused token aborts the sync; any other failure is reported per note.
 */
async function pushAll(context: ValueContext, { connection, connector }: BoundConnection, plans: ItemPlan[], ids: Map<string, string>, report: ViewReport, options: ViewSyncOptions, live: boolean) {
  const pushed = new Map<string, Set<FieldKey>>();
  const parentId = (value: unknown): string | null | undefined => {
    if (typeof value !== 'string' || !value.startsWith(PLACEHOLDER)) return value as string | null;
    const id = ids.get(value.slice(PLACEHOLDER.length));
    return id === undefined || id.startsWith(PLACEHOLDER) ? undefined : id;
  };
  for (const plan of plans) {
    if (plan.create && options.direction === 'pull') { report.skipped.push({ path: plan.path, reason: 'not synced yet; a push creates it' }); continue; }
    const values = plan.create ? new Map([...plan.local].filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0))) : plan.push;
    const fields = keys(values);
    if (fields.length === 0) continue;
    if (!live) { (plan.create ? report.created : report.updated).push({ path: plan.path, remoteId: plan.id, url: plan.url, fields }); continue; }
    const change = remoteChange(context, values) as RemotePatch;
    if (change.parentId !== undefined) { const parent = parentId(change.parentId); if (parent === undefined) delete change.parentId; else change.parentId = parent; }
    try {
      const result: RemoteItem = plan.create
        ? await connector.create(connection, { ...change, type: String(plan.local.get('type')), title: String(plan.local.get('title') ?? plan.item.title) } as RemoteDraft)
        : await connector.update(connection, plan.id!, change, plan.remote!.rev);
      if (plan.create) ids.set(plan.path, result.id);
      Object.assign(plan, { id: result.id, url: result.url, remote: result });
      pushed.set(plan.path, new Set(fields));
      (plan.create ? report.created : report.updated).push({ path: plan.path, remoteId: result.id, url: result.url, fields });
    } catch (error) {
      if (codeOf(error) === 'CONNECTOR_AUTH_FAILED') throw error;
      const stale = isRecord(error) && isRecord(error.details) && error.details.reason === 'stale-revision';
      if (stale && options.resolution) throw backlogError('SYNC_CONFLICT', `${plan.path}: the remote item changed while resolving; run backlog sync status and resolve again.`, { path: plan.path, remoteId: plan.id });
      report.failed.push({ path: plan.path, remoteId: plan.id, code: stale ? 'SYNC_CONFLICT' : codeOf(error), message: stale ? 'The remote item changed during the sync; run the sync again.' : String((error as Error).message) });
    }
  }
  return pushed;
}

/** A resolution must settle at least one conflict of its note, and every field it names, before anything is written. */
function ensureResolvable(plans: readonly ItemPlan[], resolution: Resolution): void {
  const settled = plans.flatMap(plan => plan.resolved);
  const missing = resolution.fields?.filter(field => !settled.includes(field)) ?? [];
  if (settled.length > 0 && missing.length === 0) return;
  const conflicts = plans.flatMap(plan => plan.conflicts.map(conflict => conflict.field));
  throw forgeError('INVALID_ARGUMENT', `${resolution.path} has no conflict in ${missing.length > 0 ? missing.join(', ') : 'any field'}; run backlog sync status to list conflicts.`, { path: resolution.path, conflicts: [...conflicts, ...settled] });
}

/** Post-commit events: one `connector.*` record per pushed, pulled and conflicting note, then `backlog.synced`. */
async function publish(session: BacklogSession, hub: ConnectorHub, { connection }: BoundConnection, report: ViewReport): Promise<void> {
  const base = { connection: connection.id, platform: connection.platform };
  for (const [operation, entries] of [['create', report.created], ['update', report.updated]] as const) {
    for (const entry of entries) await hub.report('pushed', { ...base, path: entry.path, remoteId: entry.remoteId!, url: entry.url!, operation, fields: entry.fields });
  }
  for (const entry of report.pulled) await hub.report('pulled', { ...base, path: entry.renamedTo ?? entry.path, remoteId: entry.remoteId!, url: entry.url!, fields: entry.fields });
  for (const entry of report.conflicts) await hub.report('conflict', { ...base, path: entry.path, remoteId: entry.remoteId!, url: entry.url!, fields: entry.fields.map(field => field.field) });
  await session.context.events.emit('backlog.synced', {
    base: report.base, view: report.view, connection: connection.id, created: report.created.length, updated: report.updated.length,
    pulled: report.pulled.length, conflicts: report.conflicts.length, left: report.left.length, failed: report.failed.length,
  });
}
