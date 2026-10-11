import type { ConnectorMapping, RemoteDraft, RemoteItem, RemotePatch } from '../../../domain/connectors/items.ts';
import { isRecord } from '../../../domain/shared/errors.ts';
import { markdownToHtml } from './markdown-html.ts';
import { PARENT_LINK, PREDECESSOR_LINK } from './processes.ts';

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

/** The JSON Patch document that creates a work item, including its area (even when area does not sync) and its parent link. */
export function createOperations(draft: RemoteDraft, context: PatchContext): PatchOperation[] {
  const { type: _type, ...rest } = draft;
  // A new item has no value to clear: null and empty values are left out.
  const set = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0)));
  const operations = fieldOperations({ ...set, ...(rest.fields ? { fields: Object.fromEntries(Object.entries(rest.fields).filter(([, value]) => value !== null)) } : {}) }, context);
  if (draft.area && context.mapping.fields.area === null) operations.push(field(AREA_PATH, draft.area));
  if (draft.parentId && context.mapping.fields.parent !== null) operations.push({ op: 'add', path: '/relations/-', value: { rel: PARENT_LINK, url: workItemApiUrl(context.organization, draft.parentId) } });
  return operations;
}

/**
 * The JSON Patch document of an update: a `test` of the expected revision first, then the field operations, then
 * the parent link change (removing the current parent relation by index, adding the new one).
 */
export function updateOperations(patch: RemotePatch, expectedRev: string, context: PatchContext, relations: readonly unknown[] = []): PatchOperation[] {
  const operations: PatchOperation[] = [{ op: 'test', path: '/rev', value: Number(expectedRev) }, ...fieldOperations(patch, context)];
  if (patch.parentId !== undefined && context.mapping.fields.parent !== null) {
    const index = relations.findIndex(relation => isRecord(relation) && relation.rel === PARENT_LINK);
    if (index >= 0) operations.push({ op: 'remove', path: `/relations/${index}` });
    if (patch.parentId !== null) operations.push({ op: 'add', path: '/relations/-', value: { rel: PARENT_LINK, url: workItemApiUrl(context.organization, patch.parentId) } });
  }
  return operations;
}

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
    parentId: lastSegment(relations.find(relation => relation.rel === PARENT_LINK)?.url),
    iteration: text(read(fields.iteration)), area: area !== null && area.toLowerCase() === context.defaultArea.toLowerCase() ? null : area,
    priority: number(read(fields.priority)), effort: number(read(fields.effort)),
    tags: (text(read(fields.tags)) ?? '').split(';').map(tag => tag.trim()).filter(Boolean),
    ...(description === undefined ? {} : { description, descriptionMarkdown: markdown }),
    links: { predecessors: relations.filter(relation => relation.rel === PREDECESSOR_LINK).map(relation => lastSegment(relation.url)).filter((value): value is string => value !== null) },
    fields: Object.fromEntries(Object.values(context.mapping.properties).map(reference => [reference, values[reference] ?? null])),
  };
}
