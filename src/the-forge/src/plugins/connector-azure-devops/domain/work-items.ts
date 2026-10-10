import type { ConnectorMapping, RemoteDraft, RemoteItem, RemotePatch } from '../../../domain/connectors/items.ts';
import { isRecord } from '../../../domain/shared/errors.ts';
import { markdownToHtml } from './markdown-html.ts';
import { PARENT_LINK, PREDECESSOR_LINK } from './processes.ts';

/** One JSON Patch operation of the Work Items API. */
export interface PatchOperation { op: 'add' | 'remove' | 'replace' | 'test'; path: string; value?: unknown }
export type DescriptionFormat = 'markdown' | 'html';

/** What a patch needs of the connection: the mapping, the description format and the work item API base. */
export interface PatchContext { mapping: ConnectorMapping; descriptionFormat: DescriptionFormat; organization: string }

const field = (reference: string, value: unknown): PatchOperation => (value === null ? { op: 'remove', path: `/fields/${reference}` } : { op: 'add', path: `/fields/${reference}`, value });
/** The relation URL of a work item, as Azure DevOps stores it in links. */
const workItemApiUrl = (organization: string, id: string) => `${organization}/_apis/wit/workItems/${id}`;
const lastSegment = (url: unknown) => (typeof url === 'string' ? /\/(\d+)$/.exec(url)?.[1] ?? null : null);

/** Field operations of a draft or patch: each mapped neutral field, extra mapped fields, and the description format. */
function fieldOperations(change: RemotePatch, context: PatchContext): PatchOperation[] {
  const { fields } = context.mapping;
  const operations: PatchOperation[] = [];
  const scalar: Array<[keyof RemotePatch, string | null]> = [['type', fields.type], ['title', fields.title], ['state', fields.state], ['iteration', fields.iteration], ['priority', fields.priority], ['effort', fields.effort]];
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

/** The JSON Patch document that creates a work item, including its area and its parent link. */
export function createOperations(draft: RemoteDraft, context: PatchContext): PatchOperation[] {
  const { type: _type, ...rest } = draft;
  const operations = fieldOperations(rest, context);
  if (draft.area) operations.push(field('System.AreaPath', draft.area));
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
  const formats = isRecord(item.multilineFieldsFormat) ? item.multilineFieldsFormat : {};
  let description: string | null | undefined;
  if (fields.description !== null) {
    const raw = text(read(fields.description));
    const markdown = String(formats[fields.description] ?? '').toLowerCase() === 'markdown';
    description = raw === null ? null : markdown ? raw : undefined;
  }
  return {
    id, rev: String(item.rev), url: url(id),
    type: String(values['System.WorkItemType'] ?? ''), title: String(read(fields.title) ?? ''), state: text(read(fields.state)),
    parentId: lastSegment(relations.find(relation => relation.rel === PARENT_LINK)?.url),
    iteration: text(read(fields.iteration)), area: text(values['System.AreaPath']),
    priority: number(read(fields.priority)), effort: number(read(fields.effort)),
    tags: (text(read(fields.tags)) ?? '').split(';').map(tag => tag.trim()).filter(Boolean),
    ...(description === undefined && fields.description !== null ? {} : { description: description ?? null }),
    links: { predecessors: relations.filter(relation => relation.rel === PREDECESSOR_LINK).map(relation => lastSegment(relation.url)).filter((value): value is string => value !== null) },
    fields: Object.fromEntries(Object.values(context.mapping.properties).map(reference => [reference, values[reference] ?? null])),
  };
}

/** A WIQL literal: single quotes doubled. */
export const wiqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** The WIQL query of items changed since a timestamp, optionally under an area path. */
export function changedSinceQuery(changedSince: string, areaPath?: string): string {
  const area = areaPath ? ` AND [System.AreaPath] UNDER ${wiqlString(areaPath)}` : '';
  return `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.ChangedDate] >= ${wiqlString(changedSince)}${area} ORDER BY [System.Id]`;
}
