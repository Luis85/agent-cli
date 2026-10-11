import type { ConnectorMapping, RemoteDraft, RemoteItem, RemotePatch } from '../../../domain/connectors/items.ts';
import { isRecord } from '../../../domain/shared/errors.ts';
import { markdownToHtml } from './markdown-html.ts';

/** One JSON Patch operation of the Work Items API. */
export interface PatchOperation { op: 'add' | 'remove' | 'replace' | 'test'; path: string; value?: unknown }
export type DescriptionFormat = 'markdown' | 'html';

/**
 * What a patch needs of the connection: the mapping, the description format, the work item API base and the
 * default area (an item there reads as having no area).
 */
export interface PatchContext { mapping: ConnectorMapping; descriptionFormat: DescriptionFormat; organization: string; defaultArea: string }

const field = (reference: string, value: unknown): PatchOperation => (value === null ? { op: 'remove', path: `/fields/${reference}` } : { op: 'add', path: `/fields/${reference}`, value });
const AREA_PATH = 'System.AreaPath';
/** The relation URL of a work item, as Azure DevOps stores it in links. */
const workItemApiUrl = (organization: string, id: string) => `${organization}/_apis/wit/workItems/${id}`;
const lastSegment = (url: unknown) => (typeof url === 'string' ? /\/(\d+)$/.exec(url)?.[1] ?? null : null);

/** Field operations of a draft or patch: each mapped neutral field, extra mapped fields, and the description format. */
function fieldOperations(change: RemotePatch, context: PatchContext): PatchOperation[] {
  const { fields } = context.mapping;
  const operations: PatchOperation[] = [];
  const scalar: Array<[keyof RemotePatch, string | null]> = [['type', fields.type], ['title', fields.title], ['state', fields.state], ['iteration', fields.iteration], ['area', fields.area], ['priority', fields.priority], ['effort', fields.effort]];
  for (const [key, reference] of scalar) if (reference !== null && change[key] !== undefined) operations.push(field(reference, change[key]));
  if (fields.tags !== null && change.tags !== undefined) operations.push(field(fields.tags, change.tags.join('; ')));
  if (fields.description !== null && change.description !== undefined) {
    const markdown = context.descriptionFormat === 'markdown';
    if (change.description === null) operations.push(field(fields.description, null));
    else {
      operations.push(field(fields.description, markdown ? change.description : markdownToHtml(change.description)));
      if (markdown) operations.push({ op: 'add', path: `/multilineFieldsFormat/${fields.description}`, value: 'Markdown' });
    }
  }
  for (const [reference, value] of Object.entries(change.fields ?? {})) operations.push(field(reference, value));
  return operations;
}

const addRelation = (rel: string, context: PatchContext, id: string): PatchOperation => ({ op: 'add', path: '/relations/-', value: { rel, url: workItemApiUrl(context.organization, id) } });
const uniqueIds = (ids: readonly string[]) => [...new Set(ids)];

/**
 * The JSON Patch document that creates a work item, including its area (even when area does not sync), its parent
 * link and its predecessor links.
 */
export function createOperations(draft: RemoteDraft, context: PatchContext): PatchOperation[] {
  const { type: _type, ...rest } = draft;
  // A new item has no value to clear: null and empty values are left out.
  const set = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)));
  const operations = fieldOperations({ ...set, ...(rest.fields ? { fields: Object.fromEntries(Object.entries(rest.fields).filter(([, value]) => value !== null)) } : {}) }, context);
  if (draft.area && context.mapping.fields.area === null) operations.push(field(AREA_PATH, draft.area));
  const { parent, dependencies } = context.mapping.fields;
  if (draft.parentId && parent !== null) operations.push(addRelation(parent, context, draft.parentId));
  if (dependencies !== null) for (const id of uniqueIds(draft.dependencies ?? [])) operations.push(addRelation(dependencies, context, id));
  return operations;
}

/**
 * The JSON Patch document of an update: a `test` of the expected revision first, then the field operations, then the
 * link changes against the item's current `relations`: the parent relation is replaced, and the predecessor relations
 * become exactly `patch.dependencies`. Relations are removed by index in descending order, so each index still names
 * the relation it was read as; additions follow.
 */
export function updateOperations(patch: RemotePatch, expectedRev: string, context: PatchContext, relations: readonly unknown[] = []): PatchOperation[] {
  const operations: PatchOperation[] = [{ op: 'test', path: '/rev', value: Number(expectedRev) }, ...fieldOperations(patch, context)];
  const { parent, dependencies } = context.mapping.fields;
  const removals: number[] = [], additions: PatchOperation[] = [];
  const indexed = relations.map((relation, index) => ({ index, rel: isRecord(relation) ? relation.rel : undefined, id: isRecord(relation) ? lastSegment(relation.url) : null }));
  if (patch.parentId !== undefined && parent !== null) {
    const current = indexed.find(relation => relation.rel === parent);
    if (current) removals.push(current.index);
    if (patch.parentId !== null) additions.push(addRelation(parent, context, patch.parentId));
  }
  if (patch.dependencies !== undefined && dependencies !== null) {
    const wanted = new Set(patch.dependencies);
    const linked = indexed.filter(relation => relation.rel === dependencies);
    removals.push(...linked.filter(relation => relation.id === null || !wanted.has(relation.id)).map(relation => relation.index));
    const kept = new Set(linked.map(relation => relation.id));
    additions.push(...uniqueIds(patch.dependencies).filter(id => !kept.has(id)).map(id => addRelation(dependencies, context, id)));
  }
  for (const index of removals.sort((a, b) => b - a)) operations.push({ op: 'remove', path: `/relations/${index}` });
  return [...operations, ...additions];
}

const WORK_ITEM_URL = /\/_apis\/wit\/workitems\/(\d+)$/i;
/**
 * What a relation is compared by: its type and its target, the work item id for a link to a work item (the server may
 * return another URL form for it) and the complete URL for any other link, so `…/pull/7` and `…/issues/7` differ.
 */
const relationKey = (relation: unknown) => {
  if (!isRecord(relation)) return '';
  const url = String(relation.url), item = WORK_ITEM_URL.exec(url)?.[1];
  return `${String(relation.rel)} ${item === undefined ? `url ${url}` : `item ${item}`}`;
};
const RELATION_INDEX = /^\/relations\/(\d+)$/;
const tally = (keys: readonly string[]) => keys.reduce((counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1), new Map<string, number>());

/**
 * Whether an update's `operations` changed the item's links as planned, judged by the relations the update returned.
 * Relations are removed by index, and the Work Items reference documents a JSON Patch `test` of `/rev` only (no test
 * of a relation). A link added or removed on the item at the other end does not revise this item, so by the time
 * the PATCH applies an index may name another relation. A relation that went meanwhile shifts only the removals at
 * or above its index, by one position each, so an update that removes nothing always landed. With `n` removals up to
 * the highest removed index, a removal can only have hit a relation up to `n` positions above that index: relations
 * read further up may have gone meanwhile, unless one read up to there is the same link, which they could stand in
 * for. Every other relation read and not removed and every one added must still be there, and every removed one gone
 * (unless a relation with the same key was allowed to go); relations added meanwhile are ignored.
 */
export function relationsLanded(read: readonly unknown[], operations: readonly PatchOperation[], result: readonly unknown[]): boolean {
  const removed = new Set(operations.flatMap(operation => (operation.op === 'remove' && RELATION_INDEX.test(operation.path) ? [Number(RELATION_INDEX.exec(operation.path)![1])] : [])));
  if (removed.size === 0) return true;
  const reach = Math.max(...removed) + removed.size;
  const added = operations.filter(operation => operation.op === 'add' && operation.path === '/relations/-').map(operation => relationKey(operation.value));
  const within = new Set(read.filter((_relation, index) => index <= reach).map(relationKey));
  const required = (relation: unknown, index: number) => (index <= reach ? !removed.has(index) : within.has(relationKey(relation)));
  const expected = tally([...read.filter(required).map(relationKey), ...added]);
  const optional = tally(read.filter((relation, index) => index > reach && !within.has(relationKey(relation))).map(relationKey));
  const actual = tally(result.map(relationKey));
  if ([...expected].some(([key, count]) => (actual.get(key) ?? 0) < count)) return false;
  return [...removed].every(index => {
    const key = relationKey(read[index]);
    return (actual.get(key) ?? 0) <= (expected.get(key) ?? 0) + (optional.get(key) ?? 0);
  });
}

/** Numeric ids in numeric order. */
const byId = (a: string, b: string) => Number(a) - Number(b) || (a < b ? -1 : a > b ? 1 : 0);
const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : null);
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null);

/** A work item response (`$expand=relations`) as a neutral remote item. */
export function remoteItem(json: unknown, context: PatchContext, url: (id: string) => string): RemoteItem {
  const item = isRecord(json) ? json : {};
  const values = isRecord(item.fields) ? item.fields : {};
  const relations = Array.isArray(item.relations) ? item.relations.filter(isRecord) : [];
  const { fields } = context.mapping;
  const id = String(item.id);
  const read = (reference: string | null) => (reference === null ? undefined : values[reference]);
  // Reads are not documented to carry multilineFieldsFormat: only an explicit Markdown format marks the text as Markdown.
  const formats = isRecord(item.multilineFieldsFormat) ? item.multilineFieldsFormat : {};
  const description = fields.description === null ? undefined : text(read(fields.description));
  const markdown = fields.description !== null && String(formats[fields.description] ?? '').toLowerCase() === 'markdown';
  const area = text(values[fields.area ?? AREA_PATH]);
  return {
    id, rev: String(item.rev), url: url(id),
    type: String(values['System.WorkItemType'] ?? ''), title: String(read(fields.title) ?? ''), state: text(read(fields.state)),
    parentId: fields.parent === null ? undefined : lastSegment(relations.find(relation => relation.rel === fields.parent)?.url),
    iteration: text(read(fields.iteration)), area: area !== null && area.toLowerCase() === context.defaultArea.toLowerCase() ? null : area,
    priority: number(read(fields.priority)), effort: number(read(fields.effort)),
    tags: (text(read(fields.tags)) ?? '').split(';').map(tag => tag.trim()).filter(Boolean),
    ...(description === undefined ? {} : { description, descriptionMarkdown: markdown }),
    ...(fields.dependencies === null ? {} : { dependencies: [...new Set(relations.filter(relation => relation.rel === fields.dependencies).map(relation => lastSegment(relation.url)).filter((value): value is string => value !== null))].sort(byId) }),
    fields: Object.fromEntries(Object.values(context.mapping.properties).map(reference => [reference, values[reference] ?? null])),
  };
}
