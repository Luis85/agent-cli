import type { RemoteItem } from '../../../domain/connectors/items.ts';
import type { Frontmatter } from '../domain/fields.ts';
import type { BacklogItem } from '../domain/model.ts';
import { canonical, decide, decideDescription, remoteType, type Decision, type FieldKey, type FieldValue } from '../domain/sync-fields.ts';
import { pathOfRemote, REMOTE_BASE, type SyncEntry, type SyncState } from '../domain/sync-state.ts';
import { itemType, linkValue, localValues, remoteValues, type ValueContext, type Values } from './sync-values.ts';

export type Direction = 'push' | 'pull' | 'both';
/**
 * `backlog sync resolve`: settle conflicting fields of one note in favour of one side (all conflicts when `fields`
 * is null). Its other pending changes wait for the next sync.
 */
export interface Resolution { path: string; take: 'local' | 'remote'; fields: FieldKey[] | null }
export interface FieldConflict { field: FieldKey; local: FieldValue; remote: FieldValue }
/** A note or one of its fields left out of the sync, with a stable `code` and a readable reason. */
export interface Skip { path: string; code: string; reason: string; field?: FieldKey }

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
  /** The remote description is known to be Markdown (or empty), so it may land in the note. */
  remoteMarkdown: boolean;
  /** Pushed fields whose next base is the value the platform stored rather than the note's value. */
  baseFrom: Map<FieldKey, 'local' | 'remote'>;
  /** Fields left out of this sync, with the reason. */
  skipped: Skip[];
  /** The note's link property is missing or names another item; the sync writes the remote URL. */
  relink: boolean;
}

/** A member of the sync set with what identifies its remote item. */
export interface Member { item: BacklogItem; frontmatter: Frontmatter; body: string | null; id: string | null; entry: SyncEntry | null; relink: boolean }
interface Source { item: BacklogItem; frontmatter: Frontmatter; body: string | null }

/**
 * Finds each member's remote item in two passes. First every note with a state entry claims its remote id. Then
 * notes known only by their link property claim theirs: a note renamed outside Forge adopts the entry of its old
 * path (returned in `adopted`), while a link to an id another note already holds (a copied note) is skipped as a
 * duplicate link and never takes the item over. A link to another connection's item skips the note, so two
 * connections never overwrite each other's link.
 */
export function identify(context: ValueContext, items: readonly Source[], state: SyncState, linkId: (url: string) => string | null, exists: (path: string) => boolean) {
  const members: Member[] = [], skipped: Skip[] = [], adopted: Array<{ from: string; to: string }> = [];
  const claimed = new Map<string, string>();
  const mapped = items.filter(({ item }) => {
    const type = itemType(item);
    if (type !== null && remoteType(context.mapping, type) !== undefined) return true;
    skipped.push({ path: item.path, code: 'unmapped-type', reason: `type ${type ?? '(none)'} has no remote type mapping` });
    return false;
  });
  const linkOf = ({ frontmatter }: Source) => { const link = linkValue(context.connection, frontmatter); return { link, id: link === null ? null : linkId(link) }; };
  for (const source of mapped) {
    const entry = state.items[source.item.path];
    if (entry === undefined) continue;
    if (claimed.has(entry.id)) { skipped.push({ path: source.item.path, code: 'duplicate-link', reason: `${claimed.get(entry.id)} already syncs remote item ${entry.id}` }); continue; }
    claimed.set(entry.id, source.item.path);
    members.push({ ...source, id: entry.id, entry, relink: linkOf(source).id !== entry.id });
  }
  const linkOnly = mapped.filter(({ item }) => state.items[item.path] === undefined).map(source => ({ source, ...linkOf(source) }));
  const linking = new Map<string, number>();
  for (const { id } of linkOnly) if (id !== null) linking.set(id, (linking.get(id) ?? 0) + 1);
  for (const { source, link, id } of linkOnly) {
    const { path } = source.item;
    if (link !== null && id === null) { skipped.push({ path, code: 'foreign-link', reason: `${context.connection.linkProperty} links an item of another connection` }); continue; }
    const previous = id === null ? null : pathOfRemote(state, id);
    const holder = id === null ? undefined : claimed.get(id) ?? (previous !== null && exists(previous) ? previous : undefined);
    if (holder !== undefined) { skipped.push({ path, code: 'duplicate-link', reason: `${holder} already syncs remote item ${id}; remove or change ${context.connection.linkProperty} in this copy` }); continue; }
    // Without a state entry nothing tells the original from its copies: none of them claims the item.
    if (id !== null && linking.get(id)! > 1) { skipped.push({ path, code: 'duplicate-link', reason: `${linking.get(id)} notes link remote item ${id}; keep ${context.connection.linkProperty} in one of them` }); continue; }
    let entry: SyncEntry | null = null;
    if (previous !== null) { entry = state.items[previous]!; adopted.push({ from: previous, to: path }); }
    if (id !== null) claimed.set(id, path);
    members.push({ ...source, id, entry, relink: false });
  }
  const order = new Map(items.map(({ item }, index) => [item.path, index]));
  members.sort((a, b) => order.get(a.item.path)! - order.get(b.item.path)!);
  return { members, skipped, adopted };
}

export interface PlanOptions { direction: Direction; resolution?: Resolution; hash(text: string): string }

const fieldSkip = (path: string, field: FieldKey, local: boolean, base: boolean): Skip => (field === 'description' && base
  ? { path, field, code: 'remote-format-unknown', reason: 'the remote description changed but is not known to be Markdown, so it is not pulled; edit the note or run backlog sync resolve with --field description' }
  : local
    ? { path, field, code: 'unexpressible', reason: `the note's ${field} cannot be expressed on this connection, so the remote value is not pulled over it` }
    : { path, field, code: 'unreadable-remote', reason: `the remote ${field} cannot be read, so the note's value is not pushed over it` });

/**
 * The three-way plan of one member. The remote side is unchanged for every field while the remote revision equals
 * the stored one; otherwise each field compares the canonical hashes of both sides with the stored base. The
 * description compares the note body and the remote text each with its own base (see `decideDescription`).
 */
export function planItem(context: ValueContext, member: Member, remote: RemoteItem | null, options: PlanOptions): ItemPlan | Skip {
  const { item, entry } = member;
  const local = localValues(context, item, member.frontmatter, member.body);
  const plan: ItemPlan = {
    item, path: item.path, frontmatter: member.frontmatter, body: member.body, id: member.id, url: remote?.url ?? entry?.url ?? null, remote, entry,
    create: member.id === null, push: new Map(), pull: new Map(), conflicts: [], converged: [], resolved: [], remoteChanged: [], local, remoteValues: new Map(),
    remoteMarkdown: false, baseFrom: new Map(), skipped: [], relink: member.relink,
  };
  if (plan.create) return plan;
  if (remote === null) return { path: item.path, code: 'remote-missing', reason: `remote item ${member.id} no longer exists or is not readable` };
  plan.remoteValues = remoteValues(context, remote);
  plan.remoteMarkdown = remote.description === null || remote.descriptionMarkdown === true;
  const unchangedRemote = entry !== null && entry.rev === remote.rev;
  const resolution = options.resolution?.path === item.path ? options.resolution : undefined;
  const hashOf = (field: FieldKey, values: Values) => (values.has(field) ? options.hash(canonical(field, values.get(field)!)) : undefined);
  for (const field of new Set([...local.keys(), ...plan.remoteValues.keys()])) {
    const baseKey = field === 'description' ? `${REMOTE_BASE}${field}` : field;
    const base = entry?.fields[field], remoteBase = entry?.fields[baseKey];
    const localHash = hashOf(field, local);
    const remoteHash = unchangedRemote && remoteBase !== undefined && plan.remoteValues.has(field) ? remoteBase : hashOf(field, plan.remoteValues);
    let decision: Decision = field === 'description'
      ? decideDescription({ local: localHash, remote: remoteHash, localBase: base, remoteBase, same: localHash !== undefined && localHash === hashOf(field, plan.remoteValues), markdown: plan.remoteMarkdown })
      : decide(base, localHash, remoteHash);
    if (decision !== 'push' && decision !== 'unchanged') plan.remoteChanged.push(field);
    const settles = decision === 'conflict' || (decision === 'skip' && localHash !== undefined && remoteHash !== undefined);
    if (resolution && decision !== 'converged' && !settles) decision = 'unchanged';
    if (settles && resolution && (resolution.fields === null || resolution.fields.includes(field))) {
      decision = resolution.take === 'local' ? 'push' : 'pull';
      plan.resolved.push(field);
    }
    if (decision === 'push' && options.direction !== 'pull') plan.push.set(field, local.get(field)!);
    else if (decision === 'pull' && options.direction !== 'push') plan.pull.set(field, plan.remoteValues.get(field)!);
    else if (decision === 'conflict') plan.conflicts.push({ field, local: local.get(field) ?? null, remote: plan.remoteValues.get(field) ?? null });
    else if (decision === 'converged') plan.converged.push(field);
    else if (decision === 'skip') plan.skipped.push(fieldSkip(item.path, field, localHash === undefined, base !== undefined));
  }
  return plan;
}

const empty = (value: FieldValue) => value === null || (Array.isArray(value) && value.length === 0);

/**
 * Takes in the item the platform returned from a create or update. Its values become the remote side, so the next
 * base reflects what the platform stored. A pushed field the platform stored differently stays local in the note
 * and is reported (`server-kept`), so the next sync pushes it again. A field the note leaves empty that the platform
 * filled (a default or a rule) is pulled in the same run, or reported (`server-applied`) on push-only runs. A field
 * the platform changed by rule beside an update is compared again on the next sync.
 */
export function settlePush(context: ValueContext, plan: ItemPlan, result: RemoteItem, direction: Direction, freshLocal: Values): void {
  const before = plan.remoteValues;
  Object.assign(plan, { id: result.id, url: result.url, remote: result, remoteValues: remoteValues(context, result), remoteMarkdown: result.description === null || result.descriptionMarkdown === true });
  const pushed = new Set(plan.create ? freshLocal.keys() : plan.push.keys());
  if (plan.create) plan.local = freshLocal;
  for (const [field, remote] of plan.remoteValues) {
    if (field === 'description') continue;
    const local = plan.local.get(field);
    if (!pushed.has(field)) {
      if (before.has(field) && canonical(field, before.get(field)!) !== canonical(field, remote)) plan.remoteChanged.push(field);
      continue;
    }
    if (local === undefined || canonical(field, local) === canonical(field, remote)) continue;
    if (!empty(local)) {
      plan.baseFrom.set(field, 'remote');
      plan.skipped.push({ path: plan.path, field, code: 'server-kept', reason: `the platform stored ${canonical(field, remote)} instead of ${canonical(field, local)}; the next sync pushes the note's value again` });
    } else if (direction === 'push') {
      plan.remoteChanged.push(field);
      plan.skipped.push({ path: plan.path, field, code: 'server-applied', reason: `the platform applied ${canonical(field, remote)}; a pull takes it into the note` });
    } else {
      plan.remoteChanged.push(field);
      plan.pull.set(field, remote);
    }
  }
}

/**
 * The base hashes after the sync: pushed and converged fields take the note's value (or the platform's, where it
 * kept another), pulled fields the remote one, and every other field keeps its previous base (conflicts stay
 * conflicts). A settled description also records the hash of the remote text as stored.
 */
export function nextBase(plan: ItemPlan, pushed: ReadonlySet<FieldKey>, pulled: ReadonlySet<FieldKey>, hash: (text: string) => string): Record<string, string> {
  const fields: Record<string, string> = { ...plan.entry?.fields };
  const set = (key: string, field: FieldKey, value: FieldValue | undefined) => { if (value !== undefined) fields[key] = hash(canonical(field, value)); };
  const settle = (field: FieldKey, value: FieldValue | undefined) => {
    set(field, field, value);
    if (field === 'description') set(`${REMOTE_BASE}${field}`, field, plan.remoteValues.get(field));
  };
  for (const field of plan.create ? plan.local.keys() : [...pushed, ...plan.converged]) settle(field, plan.baseFrom.get(field) === 'remote' ? plan.remoteValues.get(field) : plan.local.get(field));
  for (const field of pulled) settle(field, plan.remoteValues.get(field));
  return fields;
}
