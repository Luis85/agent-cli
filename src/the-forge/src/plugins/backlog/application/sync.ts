import type { BoundConnection, ConnectorHub } from '../../../application/connectors/contract.ts';
import { forgeError } from '../../../domain/shared/errors.ts';
import { noteBody } from '../domain/notes.ts';
import { canonical, type FieldKey, type FieldValue } from '../domain/sync-fields.ts';
import { pathOfRemote } from '../domain/sync-state.ts';
import type { BacklogSession } from './session.ts';
import type { SyncStore } from './sync-store.ts';
import { identify, planItem, type Direction, type ItemPlan, type Resolution, type Skip } from './sync-plan.ts';
import { PLACEHOLDER, pushAll } from './sync-push.ts';
import type { ValueContext } from './sync-values.ts';
import { commitVault, landings, type SyncChange } from './sync-vault.ts';
import { ensureWritable } from './writer.ts';

export type SyncMode = 'sync' | 'status';
/** `checkpoint` throws when the run must stop (a signal); it is called before every remote write and the vault commit. */
export interface ViewSyncOptions { mode: SyncMode; direction: Direction; resolution?: Resolution; checkpoint?: () => void }
interface Operation { path: string; remoteId: string | null; url: string | null; fields: FieldKey[] }
interface Failure { path: string; remoteId: string | null; code: string; message: string }

/** What one bound view's sync did (or, for dry runs and status, would do). */
export interface ViewReport {
  base: string; view: string; connection: string; platform: string;
  created: Operation[]; updated: Operation[]; pulled: Array<Operation & { renamedTo?: string }>;
  conflicts: Array<{ path: string; remoteId: string | null; url: string | null; fields: Array<{ field: FieldKey; local: unknown; remote: unknown }> }>;
  resolved: Array<{ path: string; take: 'local' | 'remote'; fields: FieldKey[] }>;
  unchanged: number; skipped: Skip[]; failed: Failure[];
  changes: SyncChange[];
}
/** A view's report with the note paths it holds, which decide what left the sync set of its connection. */
export interface ViewSync { report: ViewReport; members: Set<string> }

/** A remote id, or the path of a note still to be created in place of its internal placeholder. */
const readable = (id: string) => (id.startsWith(PLACEHOLDER) ? id.slice(PLACEHOLDER.length) : id);
/** A field value as reported JSON: its canonical form, naming notes still to be created by their path. */
const shown = (field: FieldKey, value: FieldValue) => {
  const named = (field === 'parent' || field === 'dependencies') && value !== null ? (Array.isArray(value) ? value.map(readable) : readable(String(value))) : value;
  return JSON.parse(canonical(field, named)) as unknown;
};

/**
 * Syncs one product-backlog view with its bound connection: identify each member's remote item, read the linked
 * remote items, plan every field three ways, then (unless status or a dry run) create and update remote items
 * parents first and commit the vault side (see `commitVault`). The caller publishes the events (see `publish`).
 */
export async function syncView(session: BacklogSession, bound: BoundConnection, store: SyncStore, hash: (text: string) => string, options: ViewSyncOptions): Promise<ViewSync> {
  const { connection, connector } = bound;
  const { workspace } = session.context;
  const live = options.mode === 'sync' && !workspace.dryRun;
  if (options.mode === 'sync') ensureWritable(session);
  const mapping = connector.mapping(connection);
  const ids = new Map<string, string>();
  const context: ValueContext = { session, connection, mapping, idOf: path => ids.get(path) ?? store.state.items[path]?.id ?? null };
  const sources = await Promise.all(session.model.results.map(async item => ({
    item, frontmatter: session.cache.getFileCache(item.path)?.frontmatter ?? {},
    body: mapping.fields.description === null ? null : noteBody(new TextDecoder().decode((await workspace.files.read(item.path)).bytes)),
  })));
  const files = new Set(session.cache.files());
  const { members, skipped, adopted } = identify(context, sources, store.state, url => connector.idFromLink(connection, url), path => files.has(path));
  for (const { from, to } of adopted) { const entry = store.state.items[from]!; store.remove(from); store.set(to, entry); }
  for (const member of members) ids.set(member.item.path, member.id ?? `${PLACEHOLDER}${member.item.path}`);
  const targets = options.resolution ? members.filter(member => member.item.path === options.resolution!.path) : members;
  const linked = targets.flatMap(member => (member.id === null ? [] : [member.id]));
  const remotes = new Map((linked.length > 0 ? await connector.query(connection, linked) : []).map(item => [item.id, item]));
  const report: ViewReport = {
    base: session.base.path, view: session.view.name, connection: connection.id, platform: connection.platform,
    created: [], updated: [], pulled: [], conflicts: [], resolved: [], unchanged: 0, skipped, failed: [], changes: [],
  };
  const plans: ItemPlan[] = [];
  for (const member of targets) {
    const plan = planItem(context, member, member.id === null ? null : remotes.get(member.id) ?? null, { direction: options.direction, hash, ...(options.resolution ? { resolution: options.resolution } : {}) });
    if ('reason' in plan) report.skipped.push(plan); else plans.push(plan);
  }
  if (options.resolution) ensureResolvable(plans, options.resolution);
  const { pushed, linkFailed } = await pushAll(context, bound, plans, ids, report, options, live, store, hash);
  // A note whose fields were written but whose link update failed still lands its pulls and its new base.
  const failed = new Set(report.failed.map(failure => failure.path).filter(path => !linkFailed.has(path)));
  const settled = plans.filter(plan => !failed.has(plan.path) && !(plan.create && (options.direction === 'pull' || plan.id === null)));
  for (const plan of plans) {
    report.skipped.push(...plan.skipped);
    if (plan.conflicts.length > 0) report.conflicts.push({ path: plan.path, remoteId: plan.id, url: plan.url, fields: plan.conflicts.map(({ field, local, remote }) => ({ field, local: shown(field, local), remote: shown(field, remote) })) });
    if (options.resolution && plan.resolved.length > 0) report.resolved.push({ path: plan.path, take: options.resolution.take, fields: plan.resolved });
  }
  report.unchanged = plans.filter(plan => !plan.create && plan.push.size + plan.pull.size + plan.conflicts.length === 0).length;
  const remotePath = (id: string) => [...ids].find(([, value]) => value === id)?.[0] ?? pathOfRemote(store.state, id);
  const landed = landings(session, context, settled, remotePath);
  for (const { plan, pulled, renameTo, skipped: skips } of landed) {
    report.skipped.push(...skips);
    if (pulled.size > 0) report.pulled.push({ path: plan.path, remoteId: plan.id, url: plan.url, fields: [...pulled], ...(renameTo ? { renamedTo: renameTo } : {}) });
  }
  const result = { report, members: new Set(members.map(member => member.item.path)) };
  if (options.mode === 'status') return result;
  options.checkpoint?.();
  report.changes = await commitVault(session, context, landed, store, pushed, hash, live);
  return result;
}

/** A resolution must settle at least one conflict of its note, and every field it names, before anything is written. */
function ensureResolvable(plans: readonly ItemPlan[], resolution: Resolution): void {
  const settled = plans.flatMap(plan => plan.resolved);
  const missing = resolution.fields?.filter(field => !settled.includes(field)) ?? [];
  if (settled.length > 0 && missing.length === 0) return;
  const conflicts = plans.flatMap(plan => plan.conflicts.map(conflict => conflict.field));
  throw forgeError('INVALID_ARGUMENT', `${resolution.path} has no conflict in ${missing.length > 0 ? missing.join(', ') : 'any field'}; run backlog sync status to list conflicts.`, { path: resolution.path, conflicts: [...conflicts, ...settled] });
}

/**
 * Post-commit events of one view: one `connector.*` record per pushed, pulled and conflicting note, then
 * `backlog.synced` with `left`, the number of notes that left the sync set of the view's connection.
 */
export async function publish(session: BacklogSession, hub: ConnectorHub, { connection }: BoundConnection, report: ViewReport, left: number): Promise<void> {
  const base = { connection: connection.id, platform: connection.platform };
  for (const [operation, entries] of [['create', report.created], ['update', report.updated]] as const) {
    for (const entry of entries) await hub.report('pushed', { ...base, path: entry.path, remoteId: entry.remoteId!, url: entry.url!, operation, fields: entry.fields });
  }
  for (const entry of report.pulled) await hub.report('pulled', { ...base, path: entry.renamedTo ?? entry.path, remoteId: entry.remoteId!, url: entry.url!, fields: entry.fields });
  for (const entry of report.conflicts) await hub.report('conflict', { ...base, path: entry.path, remoteId: entry.remoteId!, url: entry.url!, fields: entry.fields.map(field => field.field) });
  await session.context.events.emit('backlog.synced', {
    base: report.base, view: report.view, connection: connection.id, created: report.created.length, updated: report.updated.length,
    pulled: report.pulled.length, conflicts: report.conflicts.length, left, failed: report.failed.length,
  });
}
