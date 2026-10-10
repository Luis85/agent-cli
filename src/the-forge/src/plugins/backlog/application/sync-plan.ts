import type { RemoteItem } from '../../../domain/connectors/items.ts';
import type { Frontmatter } from '../domain/fields.ts';
import type { BacklogItem } from '../domain/model.ts';
import { canonical, decide, remoteType, type FieldKey, type FieldValue } from '../domain/sync-fields.ts';
import { pathOfRemote, type SyncEntry, type SyncState } from '../domain/sync-state.ts';
import { itemType, linkValue, localValues, remoteValues, type ValueContext, type Values } from './sync-values.ts';

export type Direction = 'push' | 'pull' | 'both';
/**
 * `backlog sync resolve`: settle conflicting fields of one note in favour of one side (all conflicts when `fields`
 * is null). Its other pending changes wait for the next sync.
 */
export interface Resolution { path: string; take: 'local' | 'remote'; fields: FieldKey[] | null }
export interface FieldConflict { field: FieldKey; local: FieldValue; remote: FieldValue }
export interface Skip { path: string; reason: string; field?: FieldKey }

/** One member of the sync set: its note, its remote counterpart and the field decisions. */
export interface ItemPlan {
  item: BacklogItem; path: string; frontmatter: Frontmatter; body: string | null;
  /** The remote id: known from the state or the link property; null until a planned create runs. */
  id: string | null; url: string | null; remote: RemoteItem | null;
  /** The previous sync state (base) of the note, if any. */
  entry: SyncEntry | null;
  create: boolean;
  push: Values; pull: Values; conflicts: FieldConflict[]; converged: FieldKey[];
  /** Conflicting fields a resolution settled. */
  resolved: FieldKey[];
  /** Fields whose remote value changed since the base; the stored revision advances only once all of them landed. */
  remoteChanged: FieldKey[];
  local: Values; remoteValues: Values;
  /** The note's link property is missing or names another item; the sync writes the remote URL. */
  relink: boolean;
}

/** A member of the sync set with what identifies its remote item. */
export interface Member { item: BacklogItem; frontmatter: Frontmatter; body: string | null; id: string | null; entry: SyncEntry | null; relink: boolean }

/**
 * Finds each member's remote item: its state entry by path, else the remote id in its link property (adopting the
 * entry of a note renamed outside Forge). A link to another connection's item skips the note, so two connections
 * never overwrite each other's link. Returns the members and the notes that left the sync set.
 */
export function identify(context: ValueContext, items: readonly { item: BacklogItem; frontmatter: Frontmatter; body: string | null }[], state: SyncState, linkId: (url: string) => string | null) {
  const members: Member[] = [], skipped: Skip[] = [];
  const claimed = new Set<string>();
  for (const { item, frontmatter, body } of items) {
    const type = itemType(item);
    if (type === null || remoteType(context.mapping, type) === undefined) { skipped.push({ path: item.path, reason: `type ${type ?? '(none)'} has no remote type mapping` }); continue; }
    const link = linkValue(context.connection, frontmatter);
    const linked = link === null ? null : linkId(link);
    let entry = state.items[item.path] ?? null;
    if (entry === null && linked !== null) {
      const previous = pathOfRemote(state, linked);
      if (previous !== null && !items.some(other => other.item.path === previous)) { entry = state.items[previous]!; delete state.items[previous]; state.items[item.path] = entry; }
    }
    if (entry === null && link !== null && linked === null) { skipped.push({ path: item.path, reason: `${context.connection.linkProperty} links an item of another connection` }); continue; }
    const id = entry?.id ?? linked;
    if (id !== null && claimed.has(id)) { skipped.push({ path: item.path, reason: `another note already syncs remote item ${id}` }); continue; }
    if (id !== null) claimed.add(id);
    members.push({ item, frontmatter, body, id, entry, relink: id !== null && linked !== id });
  }
  const paths = new Set(members.map(member => member.item.path));
  const left = Object.entries(state.items).filter(([path]) => !paths.has(path)).map(([path, entry]) => ({ path, remoteId: entry.id, url: entry.url }));
  return { members, skipped, left };
}

export interface PlanOptions { direction: Direction; resolution?: Resolution; hash(text: string): string }

/**
 * The three-way plan of one member. The remote side is unchanged for every field while the remote revision equals
 * the stored one; otherwise each field compares the canonical hashes of both sides with the stored base.
 */
export function planItem(context: ValueContext, member: Member, remote: RemoteItem | null, options: PlanOptions): ItemPlan | Skip {
  const { item, entry } = member;
  const local = localValues(context, item, member.frontmatter, member.body);
  const plan: ItemPlan = {
    item, path: item.path, frontmatter: member.frontmatter, body: member.body, id: member.id, url: remote?.url ?? entry?.url ?? null, remote, entry,
    create: member.id === null, push: new Map(), pull: new Map(), conflicts: [], converged: [], resolved: [], remoteChanged: [], local, remoteValues: new Map(), relink: member.relink,
  };
  if (plan.create) return plan;
  if (remote === null) return { path: item.path, reason: `remote item ${member.id} no longer exists or is not readable` };
  plan.remoteValues = remoteValues(context, remote);
  const unchangedRemote = entry !== null && entry.rev === remote.rev;
  const resolution = options.resolution?.path === item.path ? options.resolution : undefined;
  for (const field of new Set([...local.keys(), ...plan.remoteValues.keys()])) {
    const base = entry?.fields[field];
    const localHash = local.has(field) ? options.hash(canonical(field, local.get(field)!)) : undefined;
    const remoteHash = !plan.remoteValues.has(field) ? undefined : unchangedRemote && base !== undefined ? base : options.hash(canonical(field, plan.remoteValues.get(field)!));
    let decision = decide(base, localHash, remoteHash);
    if (decision === 'pull' || decision === 'conflict' || decision === 'converged') plan.remoteChanged.push(field);
    if (resolution && decision !== 'conflict' && decision !== 'converged') decision = 'unchanged';
    if (decision === 'conflict' && resolution && (resolution.fields === null || resolution.fields.includes(field))) {
      decision = resolution.take === 'local' ? 'push' : 'pull';
      plan.resolved.push(field);
    }
    if (decision === 'push' && options.direction !== 'pull') plan.push.set(field, local.get(field)!);
    else if (decision === 'pull' && options.direction !== 'push') plan.pull.set(field, plan.remoteValues.get(field)!);
    else if (decision === 'conflict') plan.conflicts.push({ field, local: local.get(field) ?? null, remote: plan.remoteValues.get(field) ?? null });
    else if (decision === 'converged') plan.converged.push(field);
  }
  return plan;
}

/**
 * The base hashes after the sync: pushed and converged fields take the local value, pulled fields the remote one,
 * and every other field keeps its previous base (conflicts stay conflicts).
 */
export function nextBase(plan: ItemPlan, local: Values, pushed: ReadonlySet<FieldKey>, pulled: ReadonlySet<FieldKey>, hash: (text: string) => string): Record<string, string> {
  const fields: Record<string, string> = { ...plan.entry?.fields };
  const set = (field: FieldKey, value: FieldValue | undefined) => { if (value !== undefined) fields[field] = hash(canonical(field, value)); };
  if (plan.create) { for (const [field, value] of local) set(field, value); return fields; }
  for (const field of [...pushed, ...plan.converged]) set(field, local.get(field));
  for (const field of pulled) set(field, plan.remoteValues.get(field));
  return fields;
}
