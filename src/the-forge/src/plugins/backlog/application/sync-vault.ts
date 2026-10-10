import type { FileChange, PlannedChange, WriteRequest } from '../../../domain/documents/file.ts';
import { setOwn, type Frontmatter } from '../domain/fields.ts';
import type { FieldKey } from '../domain/sync-fields.ts';
import { UNSETTLED_REV } from '../domain/sync-state.ts';
import type { Skip, ItemPlan } from './sync-plan.ts';
import { nextBase } from './sync-plan.ts';
import { pathTaken, wikilink, type BacklogSession } from './session.ts';
import { conflictOn, type SyncStore } from './sync-store.ts';
import { pulledNote, type PulledNote, type ValueContext } from './sync-values.ts';
import { itemEdit, planNoteEdits, type NoteEdit } from './writer.ts';

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');

/** How one plan's pulled values land: the note changes, the fields that can land, and a rename for a new title. */
export interface Landing { plan: ItemPlan; note: PulledNote; pulled: Set<FieldKey>; renameTo: string | null; skipped: Skip[] }
/** A note the sync renames for a pulled title; dry runs carry `diff: null` like other planned changes. */
export interface RenameChange { path: string; oldPath: string; operation: 'renamed'; revision: string; bytes: number; diff?: null }
export type SyncChange = FileChange | PlannedChange | RenameChange;

/**
 * Converts each plan's pulls into note changes; values without a local counterpart and taken titles are skipped.
 * Notes renamed for a pulled title are known before any parent link is written, so a note re-parented to a note
 * renamed in the same run links the new name.
 */
export function landings(session: BacklogSession, context: ValueContext, plans: readonly ItemPlan[], pathOfRemote: (id: string) => string | null): Landing[] {
  const landed = plans.map(plan => {
    const note = pulledNote(context, plan.item, plan.pull, pathOfRemote, plan.body);
    const skipped: Skip[] = note.skipped.map(skip => ({ path: plan.path, ...skip }));
    const pulled = new Set([...plan.pull.keys()].filter(field => !note.skipped.some(skip => skip.field === field)));
    let renameTo: string | null = null;
    if (note.title !== undefined) {
      const folder = plan.path.includes('/') ? plan.path.slice(0, plan.path.lastIndexOf('/') + 1) : '';
      const target = `${folder}${note.title}.md`;
      if (target.toLowerCase() !== plan.path.toLowerCase() && pathTaken(session, target)) { pulled.delete('title'); skipped.push({ path: plan.path, field: 'title', code: 'title-taken', reason: `${target} already exists` }); }
      else if (target !== plan.path) renameTo = target;
    }
    return { plan, note, pulled, renameTo, skipped };
  });
  const renamed = new Map(landed.flatMap(landing => (landing.renameTo === null ? [] : [[landing.plan.path, landing.renameTo] as const])));
  for (const { note } of landed) if (typeof note.write.parent === 'string') note.write.parent = renamed.get(note.write.parent) ?? note.write.parent;
  return landed;
}

/**
 * The vault side of a sync: notes whose remote title changed are renamed first (rewriting links), then pulled
 * fields, link properties and the state file are written in one guarded batch. Dry runs plan the same writes and
 * return diffs. When only the state file changed meanwhile (another process moved a note), the batch is planned
 * again against the re-read state once.
 */
export async function commitVault(session: BacklogSession, context: ValueContext, items: readonly Landing[], store: SyncStore, pushed: ReadonlyMap<string, ReadonlySet<FieldKey>>, hash: (text: string) => string, live: boolean) {
  const { connection } = context;
  const { workspace } = session.context;
  const edits: NoteEdit[] = [];
  const changes: SyncChange[] = [];
  // A dry run renames nothing, so a link to a note it plans to rename is written as the rename would leave it.
  const plannedFrom = new Map(live ? [] : items.flatMap(({ plan, renameTo }) => (renameTo === null ? [] : [[renameTo, plan.path] as const])));
  const links = (target: string, source: string) => {
    const from = plannedFrom.get(target);
    if (from === undefined) return wikilink(session, target, source);
    const text = session.cache.fileToLinktext(from, source), old = basename(from), next = basename(target);
    return `[[${text.endsWith(old) ? `${text.slice(0, -old.length)}${next}` : text}]]`;
  };
  for (const { plan, note, pulled, renameTo } of items) {
    let path = plan.path;
    if (renameTo !== null) {
      const moved = await session.context.app.fileManager.move(plan.path, renameTo);
      for (const rename of moved.renames) if (rename.kind === 'file') changes.push({ path: rename.to, oldPath: rename.from, operation: 'renamed', revision: rename.revision, bytes: rename.bytes, ...(moved.dryRun ? { diff: null } : {}) });
      changes.push(...moved.changes);
      if (live) { path = renameTo; store.remove(plan.path); }
    }
    const extra: Frontmatter = { ...note.extra };
    if (plan.url !== null && (plan.relink || plan.create)) setOwn(extra, connection.linkProperty, plan.url);
    if (Object.keys(note.write).length > 1 || Object.keys(extra).length > 0 || note.removed.length > 0 || note.body !== undefined) {
      const write = itemEdit(session, { ...note.write, path }, links);
      edits.push({
        path, ...(note.body === undefined ? {} : { body: note.body }),
        edit: frontmatter => {
          const failure = write.edit(frontmatter);
          if (failure) return failure;
          for (const [key, value] of Object.entries(extra)) setOwn(frontmatter, key, value);
          for (const key of note.removed) delete frontmatter[key];
          return null;
        },
      });
    }
    if (plan.id === null || plan.remote === null) continue;
    // While remote changes are still pending (conflicts, skipped or held-back pulls) the old revision stays, so the next sync compares them again.
    const absorbed = plan.remoteChanged.every(field => pulled.has(field) || plan.converged.includes(field));
    const rev = absorbed ? plan.remote.rev : plan.entry?.rev ?? UNSETTLED_REV;
    store.set(path, { id: plan.id, url: plan.url ?? plan.remote.url, rev, fields: nextBase(plan, pushed.get(plan.path) ?? new Set(), pulled, hash) });
  }
  for (let attempt = 1; ; attempt++) {
    const requests: WriteRequest[] = await planNoteEdits(session, edits);
    const state = store.request();
    if (requests.length + (state ? 1 : 0) === 0) return changes;
    try {
      const result = await workspace.write([...requests, ...(state ? [state] : [])], { diff: true });
      store.committed(result.changes);
      return [...changes, ...result.changes];
    } catch (error) {
      if (!live || attempt > 1 || !conflictOn(error, store.path)) throw error;
      await store.refresh();
    }
  }
}
