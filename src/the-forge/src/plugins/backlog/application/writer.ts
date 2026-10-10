import type { FileChange, PlannedChange, WriteRequest } from '../../../domain/documents/file.ts';
import { forgeError } from '../../../domain/shared/errors.ts';
import { revisionConflict } from '../../../domain/documents/write-plan.ts';
import { backlogError, refused } from '../domain/errors.ts';
import type { Frontmatter } from '../domain/fields.ts';
import { noteText, withBody } from '../domain/notes.ts';
import { configProblems } from '../domain/settings.ts';
import { applyItemWrite, type ItemWrite, type WriteRefusal } from '../domain/writes.ts';
import { typeOf, wikilink, type BacklogSession } from './session.ts';

/** A planned file in a write result: the path, operation, revision and bytes, with a unified diff on dry runs. */
export type Change = FileChange | PlannedChange;
export interface WriteResult { dryRun: boolean; changes: Change[] }

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const json = (value: unknown) => JSON.stringify(value);
const messages: Record<WriteRefusal, string> = {
  resource: 'Resource notes are never written by the backlog.',
  'field-not-held': 'The note\'s type may not hold this field.',
  'not-a-release': 'A release link must point to a Release note.',
  'not-a-resource': 'An assignee link must point to a Resource note.',
  'reversed-span': 'The planned start would fall after the target date.',
};

/** Writes are refused while two roles share one key, as the plugin's write gate refuses them. */
export function ensureWritable(session: BacklogSession): void {
  const problems = configProblems(session.settings);
  if (problems.length > 0) throw backlogError('BACKLOG_CONFIG_PROBLEM', `Fix the backlog configuration first: ${problems[0]}`, { problems, base: session.base.path, view: session.view.name });
}

/** Context rows (ancestors outside the base filter) are never written. */
function ensureInFilter(session: BacklogSession, path: string): void {
  const item = session.model.byPath.get(path);
  if (item === undefined || item.outsideFilter) throw refused('outside-filter', `${path} is outside the filter of ${session.base.path} › ${session.view.name}; context rows are read-only.`, { path });
}

/**
 * One note's edit: mutate the live properties in place, or return why the note refuses it. `body`, when given,
 * replaces the text after the frontmatter (the backlog sync engine writes descriptions there).
 */
export interface NoteEdit { path: string; edit(frontmatter: Frontmatter): Error | null; body?: string }

/**
 * Plans frontmatter edits as guarded write requests without committing them: each note is read, re-checked and
 * changed like backlog-view's `processFrontMatter` callback (changed keys set, removed keys deleted, other keys and
 * their formatting kept). A refusal anywhere refuses the whole plan. `ifMatch` guards the first edited note.
 */
export async function planNoteEdits(session: BacklogSession, edits: readonly NoteEdit[], ifMatch?: string): Promise<WriteRequest[]> {
  const { workspace } = session.context;
  const requests: WriteRequest[] = [];
  for (const [index, { path, edit, body }] of edits.entries()) {
    const snapshot = await workspace.files.read(path);
    if (index === 0 && ifMatch !== undefined && ifMatch !== snapshot.revision) {
      throw forgeError('CONFLICT', `File changed; read again before editing: ${path}`, revisionConflict(path, ifMatch, snapshot.revision));
    }
    const before = (workspace.codec.inspect(path, snapshot.bytes) as { properties: Frontmatter }).properties;
    const after = structuredClone(before);
    const failure = edit(after);
    if (failure) throw failure;
    const changes = Object.fromEntries(Object.entries(after).filter(([key, value]) => json(value) !== json(before[key])));
    const removed = Object.keys(before).filter(key => !Object.hasOwn(after, key));
    const text = decoder.decode(snapshot.bytes);
    const edited = Object.keys(changes).length + removed.length === 0 ? text : session.ports.editFrontmatter(text, after, changes, removed);
    const next = body === undefined ? edited : withBody(edited, body);
    if (next !== text) requests.push({ path, bytes: encoder.encode(next), expectedRevision: snapshot.revision });
  }
  return requests;
}

/** Applies frontmatter edits in one guarded batch (see `planNoteEdits`). */
export async function editNotes(session: BacklogSession, edits: readonly NoteEdit[], ifMatch?: string): Promise<WriteResult> {
  const requests = await planNoteEdits(session, edits, ifMatch);
  if (requests.length === 0) return { dryRun: session.context.workspace.dryRun, changes: [] };
  return session.context.workspace.write(requests, { diff: true });
}

/**
 * One item write as a note edit through backlog-view's live-note refusal rules. `links` overrides how a link to a
 * target is written (a dry run linking a note it only plans to rename).
 */
export function itemEdit(session: BacklogSession, write: ItemWrite, links?: (target: string, source: string) => string): NoteEdit {
  const env = { settings: session.settings, wikilink: links ?? ((target: string, source: string) => wikilink(session, target, source)), resolve: (linkpath: string, source: string) => session.cache.getClosestLinkpathDest(linkpath, source), typeOf: (path: string) => typeOf(session, path) };
  return {
    path: write.path,
    edit: frontmatter => { const refusal = applyItemWrite(frontmatter, write, env); return refusal ? refused(refusal, `${write.path}: ${messages[refusal]}`, { path: write.path }) : null; },
  };
}

/** Item writes through the write gate: configuration problems and context rows refuse the batch. */
export async function writeItems(session: BacklogSession, writes: readonly ItemWrite[], ifMatch?: string): Promise<WriteResult> {
  ensureWritable(session);
  for (const write of writes) ensureInFilter(session, write.path);
  return editNotes(session, writes.map(write => itemEdit(session, write)), ifMatch);
}

/** Creates new notes in one batch; an existing path is a conflict, never overwritten. */
export async function createNotes(session: BacklogSession, files: ReadonlyArray<{ path: string; text: string }>): Promise<WriteResult> {
  return session.context.workspace.write(files.map(file => ({ path: file.path, bytes: encoder.encode(file.text) })), { diff: true });
}

/** A new note's text: `---\n<stringifyYaml(frontmatter)>---\n`, the plugin's `vault.create` content. */
export const newNoteText = (session: BacklogSession, frontmatter: Frontmatter) => noteText(session.ports.stringifyYaml(frontmatter));

/** Publishes a `backlog.*` event after a committed write; dry runs publish nothing. */
export async function announce(session: BacklogSession, result: WriteResult, id: string, payload: Record<string, unknown>): Promise<void> {
  if (result.dryRun || result.changes.length === 0) return;
  await session.context.events.emit(id, payload);
}
