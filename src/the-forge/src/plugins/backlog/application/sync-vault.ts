import type { FileChange, PlannedChange, WriteRequest } from '../../../domain/documents/file.ts';
import { setOwn, type Frontmatter } from '../domain/fields.ts';
import type { FieldKey } from '../domain/sync-fields.ts';
import type { Skip, ItemPlan } from './sync-plan.ts';
import { nextBase } from './sync-plan.ts';
import { pathTaken, type BacklogSession } from './session.ts';
import { stateWrite, type StoredState } from './sync-store.ts';
import { localValues, pulledNote, type PulledNote, type ValueContext } from './sync-values.ts';
import { itemEdit, planNoteEdits, type NoteEdit } from './writer.ts';

/** How one plan's pulled values land: the note changes, the fields that can land, and a rename for a new title. */
export interface Landing { plan: ItemPlan; note: PulledNote; pulled: Set<FieldKey>; renameTo: string | null; skipped: Skip[] }

/** Converts each plan's pulls into note changes; values without a local counterpart and taken titles are skipped. */
export function landings(session: BacklogSession, context: ValueContext, plans: readonly ItemPlan[], pathOfRemote: (id: string) => string | null): Landing[] {
  return plans.map(plan => {
    const note = pulledNote(context, plan.item, plan.pull, pathOfRemote);
    const skipped: Skip[] = note.skipped.map(skip => ({ path: plan.path, ...skip }));
    const pulled = new Set([...plan.pull.keys()].filter(field => !note.skipped.some(skip => skip.field === field)));
    let renameTo: string | null = null;
    if (note.title !== undefined) {
      const folder = plan.path.includes('/') ? plan.path.slice(0, plan.path.lastIndexOf('/') + 1) : '';
      const target = `${folder}${note.title}.md`;
      if (target.toLowerCase() !== plan.path.toLowerCase() && pathTaken(session, target)) { pulled.delete('title'); skipped.push({ path: plan.path, field: 'title', reason: `${target} already exists` }); }
      else if (target !== plan.path) renameTo = target;
    }
    return { plan, note, pulled, renameTo, skipped };
  });
}

/**
 * The vault side of a sync: notes whose remote title changed are renamed first (rewriting links), then pulled
 * fields, link properties and the state file are written in one guarded batch. Dry runs plan the same writes and
 * return diffs. If the batch fails after remote items were created, the state alone is saved, so a retry links
 * them instead of creating them twice.
 */
export async function commitVault(session: BacklogSession, context: ValueContext, items: readonly Landing[], stored: StoredState, pushed: ReadonlyMap<string, ReadonlySet<FieldKey>>, hash: (text: string) => string, live: boolean, created: boolean) {
  const { connection } = context;
  const edits: NoteEdit[] = [];
  const changes: Array<FileChange | PlannedChange> = [];
  for (const { plan, note, pulled, renameTo } of items) {
    let path = plan.path;
    if (renameTo !== null) {
      changes.push(...(await session.context.app.fileManager.move(plan.path, renameTo)).changes);
      if (live) { path = renameTo; delete stored.state.items[plan.path]; }
    }
    const extra: Frontmatter = { ...note.extra };
    if (plan.url !== null && (plan.relink || plan.create)) setOwn(extra, connection.linkProperty, plan.url);
    if (Object.keys(note.write).length > 1 || Object.keys(extra).length > 0 || note.removed.length > 0 || note.body !== undefined) {
      const write = itemEdit(session, { ...note.write, path });
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
    const local = plan.create ? localValues(context, plan.item, plan.frontmatter, plan.body) : plan.local;
    // While remote changes are still pending (conflicts, skipped or held-back pulls) the old revision stays, so the next sync compares them again.
    const absorbed = plan.remoteChanged.every(field => pulled.has(field) || plan.converged.includes(field));
    const rev = absorbed || plan.entry === null ? plan.remote.rev : plan.entry.rev;
    stored.state.items[path] = { id: plan.id, url: plan.url ?? plan.remote.url, rev, fields: nextBase(plan, local, pushed.get(plan.path) ?? new Set(), pulled, hash) };
  }
  const requests: WriteRequest[] = await planNoteEdits(session, edits);
  const state = stateWrite(stored);
  if (requests.length + (state ? 1 : 0) === 0) return changes;
  try {
    changes.push(...(await session.context.workspace.write([...requests, ...(state ? [state] : [])], { diff: true })).changes);
  } catch (error) {
    if (live && state && created) await session.context.workspace.write([state]);
    throw error;
  }
  return changes;
}
