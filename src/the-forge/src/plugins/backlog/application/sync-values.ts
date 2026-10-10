import type { Connection } from '../../../application/connectors/contract.ts';
import type { ConnectorMapping, RemoteItem, SyncField } from '../../../domain/connectors/items.ts';
import { formatCivil, ownValue, readNumber, readString, setOwn, type Frontmatter } from '../domain/fields.ts';
import { displayType, type BacklogItem } from '../domain/model.ts';
import { comments, sanitizeTitle, withoutComments } from '../domain/notes.ts';
import { isIterationType } from '../domain/vocabulary.ts';
import {
  iterationName, iterationPath, localState, localType, priorityLabel, priorityNumber, remoteState, remoteType, type FieldKey, type FieldValue,
} from '../domain/sync-fields.ts';
import type { ItemWrite } from '../domain/writes.ts';
import { stateWrite } from './editing.ts';
import type { BacklogSession } from './session.ts';

/** What field values depend on besides the item: the connection, its mapping and remote ids of other notes. */
export interface ValueContext {
  session: BacklogSession; connection: Connection; mapping: ConnectorMapping;
  /** The remote id of a note synced (or about to be created) on this connection, or null. */
  idOf(path: string): string | null;
}

export type Values = Map<FieldKey, FieldValue>;
const PROPERTY = 'property:';
const iterationRoot = (context: ValueContext) => {
  const root = context.connection.settings.iterationRoot;
  return typeof root === 'string' && root.trim() !== '' ? root.trim().replace(/\\+$/, '') : null;
};
/**
 * Whether a field syncs at all: the connection maps it and the view binds the property that holds it (iterations
 * also need the connection's iteration root). Fields that do not sync are compared on neither side.
 */
function synced(context: ValueContext, field: SyncField): boolean {
  const { settings } = context.session;
  if (context.mapping.fields[field] === null) return false;
  if (field === 'state') return settings.stateKey !== '';
  if (field === 'iteration') return iterationRoot(context) !== null && settings.iterationKey !== '';
  if (field === 'priority') return settings.priorityKey !== '';
  if (field === 'tags') return settings.tagsKey !== '';
  if (field === 'area') return context.connection.areaProperty !== '';
  return true;
}
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
/** The Iteration note with this name (case-insensitive) anywhere in the scope. */
const iterationNote = (session: BacklogSession, name: string) => session.cache.files().find(path => path.toLowerCase().endsWith('.md')
  && basename(path).toLowerCase() === name.toLowerCase() && isIterationType(readString(ownValue(session.cache.getFileCache(path)?.frontmatter, session.settings.typeKey)))) ?? null;
const scalar = (value: unknown): FieldValue | undefined => (value === undefined || value === null || value === '' ? null : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined);

/** The local type name an item syncs as: its own type, else the type its rung implies. */
export const itemType = (item: BacklogItem) => item.typeName ?? (displayType(item) || null);

/**
 * The item's comparable field values in the remote vocabulary. A field is absent when it is not mapped, its backlog
 * property is unbound, or this side cannot express it (a parent that is not synced on this connection).
 */
export function localValues(context: ValueContext, item: BacklogItem, frontmatter: Frontmatter, body: string | null): Values {
  const values: Values = new Map();
  const type = itemType(item);
  if (synced(context, 'title')) values.set('title', item.title);
  const remote = type === null ? undefined : remoteType(context.mapping, type);
  if (synced(context, 'type') && remote !== undefined) values.set('type', remote);
  if (synced(context, 'state')) values.set('state', item.stateValue === null ? null : remoteState(context.mapping, type, item.stateValue));
  if (synced(context, 'parent')) {
    const parent = item.parent === null ? null : context.idOf(item.parent.path);
    if (item.parent === null || parent !== null) values.set('parent', parent);
  }
  const root = iterationRoot(context);
  if (synced(context, 'iteration') && root !== null) {
    const entry = item.iterationEntry;
    if (entry === null) values.set('iteration', null);
    else if (entry.path !== null) values.set('iteration', iterationPath(root, basename(entry.path)));
  }
  if (synced(context, 'area')) {
    const area = scalar(ownValue(frontmatter, context.connection.areaProperty));
    if (area === null || typeof area === 'string') values.set('area', area === null ? null : area.trim().replace(/\\+$/, '') || null);
  }
  if (synced(context, 'priority')) {
    const number = priorityNumber(item.priorityValue);
    if (item.priorityValue === null || number !== null) values.set('priority', number);
  }
  if (synced(context, 'effort')) {
    const raw = ownValue(frontmatter, context.connection.effortProperty);
    const number = readNumber(raw);
    if (raw === undefined || raw === null || raw === '' || number !== null) values.set('effort', number);
  }
  if (synced(context, 'tags')) values.set('tags', item.tags);
  if (synced(context, 'description') && body !== null) { const text = withoutComments(body.replace(/\r\n?/g, '\n')).trim(); values.set('description', text === '' ? null : text); }
  for (const key of Object.keys(context.mapping.properties)) {
    const value = scalar(ownValue(frontmatter, key));
    if (value !== undefined) values.set(`${PROPERTY}${key}`, value);
  }
  return values;
}

/** The remote item's comparable values; the description is the remote text as read, whatever its format. */
export function remoteValues(context: ValueContext, remote: RemoteItem): Values {
  const values: Values = new Map();
  if (synced(context, 'title')) values.set('title', remote.title);
  if (synced(context, 'type')) values.set('type', remote.type);
  if (synced(context, 'state')) values.set('state', remote.state);
  if (synced(context, 'parent')) values.set('parent', remote.parentId ?? null);
  const root = iterationRoot(context);
  if (synced(context, 'iteration') && root !== null) values.set('iteration', iterationName(root, remote.iteration ?? null) === null ? null : remote.iteration ?? null);
  if (synced(context, 'area') && remote.area !== undefined) values.set('area', remote.area);
  if (synced(context, 'priority')) values.set('priority', remote.priority ?? null);
  if (synced(context, 'effort')) values.set('effort', remote.effort ?? null);
  if (synced(context, 'tags')) values.set('tags', remote.tags);
  if (synced(context, 'description') && remote.description !== undefined) values.set('description', remote.description);
  for (const [key, reference] of Object.entries(context.mapping.properties)) {
    const value = scalar(remote.fields[reference]);
    if (value !== undefined) values.set(`${PROPERTY}${key}`, value);
  }
  return values;
}

/** The connector draft or patch fields for pushed values. */
export function remoteChange(context: ValueContext, values: Values): Record<string, unknown> {
  const change: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {};
  for (const [key, value] of values) {
    if (key.startsWith(PROPERTY)) fields[context.mapping.properties[key.slice(PROPERTY.length)]!] = value;
    else if (key === 'parent') change.parentId = value;
    else change[key] = value;
  }
  return Object.keys(fields).length > 0 ? { ...change, fields } : change;
}

/** How pulled values land in a note: a backlog item write, extra frontmatter, a new body and a new title. */
export interface PulledNote { write: ItemWrite; extra: Frontmatter; removed: string[]; body?: string; title?: string; skipped: Array<{ field: FieldKey; code: string; reason: string }> }

/**
 * Converts pulled remote values into note changes with the backlog's write rules; unmappable values are skipped.
 * A pulled description replaces the body but keeps the note's `%%comments%%`, appended after it, since comments
 * never sync.
 */
export function pulledNote(context: ValueContext, item: BacklogItem, pulls: Values, pathOfRemote: (id: string) => string | null, body: string | null): PulledNote {
  const { session } = context;
  const { settings } = session;
  const note: PulledNote = { write: { path: item.path }, extra: {}, removed: [], skipped: [] };
  const type = itemType(item);
  for (const [field, value] of pulls) {
    if (field === 'title') note.title = sanitizeTitle(String(value));
    else if (field === 'type' && typeof value === 'string') {
      const local = localType(context.mapping, value, type);
      if (local === undefined) note.skipped.push({ field, code: 'unmapped-remote-type', reason: `remote type ${value} has no local type mapping; add it to mappings.types` });
      else note.write.typeName = local;
    }
    else if (field === 'state') Object.assign(note.write, stateWrite(item, value === null ? null : localState(context.mapping, type, String(value), item.stateValue, settings.states), settings, formatCivil(session.today)));
    else if (field === 'parent') {
      const parent = value === null ? null : pathOfRemote(String(value));
      if (value !== null && parent === null) note.skipped.push({ field, code: 'unsynced-parent', reason: `remote parent ${String(value)} is not synced on this connection` });
      else note.write.parent = parent;
    } else if (field === 'iteration') {
      const name = iterationName(iterationRoot(context)!, value === null ? null : String(value));
      const target = name === null ? null : iterationNote(session, name);
      if (name !== null && target === null) note.skipped.push({ field, code: 'missing-iteration', reason: `no iteration note named ${name}` });
      else note.write.iteration = target;
    } else if (field === 'priority') note.write.priority = value === null ? null : priorityLabel(Number(value), settings.priorityValues);
    else if (field === 'tags' && Array.isArray(value)) {
      const lower = new Set(value.map(tag => tag.toLowerCase()));
      note.write.tags = { add: value, remove: item.tags.filter(tag => !lower.has(tag.toLowerCase())) };
    } else if (field === 'description') note.body = [value === null ? '' : String(value), ...comments(body ?? '')].filter(part => part.trim() !== '').join('\n\n');
    else {
      const key = field === 'effort' ? context.connection.effortProperty : field === 'area' ? context.connection.areaProperty : field.slice(PROPERTY.length);
      if (value === null) note.removed.push(key); else setOwn(note.extra, key, value);
    }
  }
  return note;
}

/** The note's link property value, when it holds one. */
export const linkValue = (connection: Connection, frontmatter: Frontmatter | undefined) => readString(ownValue(frontmatter, connection.linkProperty));
