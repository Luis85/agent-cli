import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One work item as the fake stores it: Azure DevOps' wire shape. */
export interface FakeWorkItem {
  id: number; rev: number; fields: Record<string, unknown>;
  relations: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
  multilineFieldsFormat: Record<string, string>;
}
export interface FakeRequest { method: string; path: string; body: unknown }

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
};
/** The error body shape of the service: a .NET exception summary. */
const serviceError = (message: string, typeKey: string) => ({
  $id: '1', innerException: null, message, typeName: `Microsoft.TeamFoundation.WorkItemTracking.Server.${typeKey}, Microsoft.TeamFoundation.WorkItemTracking.Server`, typeKey, errorCode: 0, eventId: 3200,
});
const read = (request: IncomingMessage) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(chunk as Buffer));
  request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  request.on('error', reject);
});

/**
 * An in-process fake of the Azure DevOps Work Items REST API (api-version 7.1) for the endpoints the connector
 * uses: project probe, workitemsbatch, create, get and update with JSON Patch. Revisions increase on every write
 * and a failed `test /rev` answers 412, like the service. Each organization (`/<org>/`) holds its own items; every
 * request needs `Authorization: Basic base64(":" + pat)`. Reads leave out `multilineFieldsFormat` (the API reference
 * does not document it on reads) unless `returnsFormats` is set.
 */
export class FakeAzureDevOps {
  readonly requests: FakeRequest[] = [];
  /** Reads include each item's `multilineFieldsFormat`. */
  returnsFormats = false;
  /** Creates refuse any state but the initial `New`, as processes with enforced state transitions do. */
  initialStateOnly = false;
  /** Fields a create applies when the request leaves them out, like process defaults and rules (for example a priority). */
  createDefaults: Record<string, unknown> = {};
  /** Runs after each committed create or update, before the response is sent (to simulate concurrent changes). */
  afterWrite: ((item: FakeWorkItem, operation: 'create' | 'update') => void | Promise<void>) | null = null;
  private readonly items = new Map<string, Map<number, FakeWorkItem>>();
  private readonly nextId = new Map<string, number>();
  private clock = Date.UTC(2026, 9, 1);
  private throttle = 0;
  private server = createServer((request, response) => { void this.handle(request, response); });
  base = '';

  /** `pat` may be replaced to revoke the token mid-run. */
  constructor(public pat: string, readonly projects: Record<string, string> = {}) {}

  async start(): Promise<this> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }
  close(): Promise<void> { return new Promise(resolve => this.server.close(() => resolve())); }

  /** The organization URL a connection profile names. */
  organization(name: string): string { return `${this.base}/${name}`; }
  /** Every item of an organization in id order. */
  list(organization: string): FakeWorkItem[] { return [...(this.items.get(organization) ?? new Map()).values()].sort((a, b) => a.id - b.id); }
  item(organization: string, id: number): FakeWorkItem { return this.items.get(organization)!.get(id)!; }
  /** Answers the next `count` requests with 429 and `Retry-After: 0`. */
  throttleNext(count: number): void { this.throttle = count; }
  /** Writes requests (create and update) so far, by method and path. */
  writes(): FakeRequest[] { return this.requests.filter(request => request.method === 'PATCH' || (request.method === 'POST' && request.path.includes('/workitems/$'))); }

  /** A change made by someone else in Azure DevOps: fields set (null removes), revision and ChangedDate advanced. */
  edit(organization: string, id: number, fields: Record<string, unknown>, formats: Record<string, string> = {}): FakeWorkItem {
    const item = this.item(organization, id);
    for (const [key, value] of Object.entries(fields)) if (value === null) delete item.fields[key]; else item.fields[key] = value;
    Object.assign(item.multilineFieldsFormat, formats);
    return this.touch(item);
  }
  /** Re-parents an item remotely. */
  reparent(organization: string, id: number, parent: number | null): FakeWorkItem {
    const item = this.item(organization, id);
    item.relations = item.relations.filter(relation => relation.rel !== 'System.LinkTypes.Hierarchy-Reverse');
    if (parent !== null) item.relations.push({ rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${this.organization(organization)}/_apis/wit/workItems/${parent}` });
    return this.touch(item);
  }

  private touch(item: FakeWorkItem): FakeWorkItem {
    item.rev += 1;
    this.clock += 60_000;
    item.fields['System.Rev'] = item.rev;
    item.fields['System.ChangedDate'] = new Date(this.clock).toISOString();
    return item;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.base);
    const text = await read(request);
    let body: unknown = null;
    try { body = text === '' ? null : JSON.parse(text); } catch { body = text; }
    this.requests.push({ method: request.method ?? 'GET', path: `${url.pathname}${url.search}`, body });
    if (this.throttle > 0) { this.throttle -= 1; json(response, 429, { message: 'Too many requests' }, { 'retry-after': '0' }); return; }
    if (request.headers.authorization !== `Basic ${Buffer.from(`:${this.pat}`).toString('base64')}`) { json(response, 401, { message: 'Unauthorized' }); return; }
    if (url.searchParams.get('api-version') !== '7.1') { json(response, 400, { message: 'api-version 7.1 is required' }); return; }
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [organization, second, third] = parts;
    if (second === '_apis' && third === 'projects') return this.project(response, organization!, parts[3]!);
    const project = second!;
    if (this.projects[organization!] !== undefined && this.projects[organization!] !== project) { json(response, 404, { message: `Project ${project} does not exist.` }); return; }
    const rest = parts.slice(2).join('/');
    const store = this.items.get(organization!) ?? new Map<number, FakeWorkItem>();
    this.items.set(organization!, store);
    if (request.method === 'POST' && rest === '_apis/wit/workitemsbatch') {
      const ids = (body as { ids: number[] }).ids;
      return json(response, 200, { count: ids.length, value: ids.map(id => (store.has(id) ? this.wire(organization!, store.get(id)!) : null)).filter(Boolean) });
    }
    const create = /^_apis\/wit\/workitems\/\$(.+)$/.exec(rest);
    if (request.method === 'POST' && create) return this.create(response, organization!, project, store, create[1]!, body as Operation[]);
    const single = /^_apis\/wit\/workitems\/(\d+)$/.exec(rest);
    const item = single ? store.get(Number(single[1])) : undefined;
    if (single && !item) return json(response, 404, serviceError(`TF401232: Work item ${single[1]} does not exist, or you do not have permissions to read it.`, 'WorkItemUnauthorizedAccessException'));
    if (request.method === 'GET' && item) return json(response, 200, this.wire(organization!, item));
    if (request.method === 'PATCH' && item) return this.update(response, organization!, item, body as Operation[]);
    // A route the fake does not know is a test bug, never a service answer.
    json(response, 404, { message: `No route for ${request.method} ${url.pathname}` });
  }

  private project(response: ServerResponse, organization: string, project: string): void {
    if (this.projects[organization] !== undefined && this.projects[organization] !== project) return json(response, 404, { message: `Project ${project} does not exist.` });
    json(response, 200, { id: `${organization}-${project}-id`, name: project, state: 'wellFormed', capabilities: { processTemplate: { templateName: 'Agile' } } });
  }

  private async create(response: ServerResponse, organization: string, project: string, store: Map<number, FakeWorkItem>, type: string, operations: Operation[]): Promise<void> {
    const id = this.nextId.get(organization) ?? 1;
    this.nextId.set(organization, id + 1);
    const item: FakeWorkItem = { id, rev: 0, fields: { 'System.WorkItemType': type, 'System.State': 'New', 'System.AreaPath': project, 'System.IterationPath': project, 'System.TeamProject': project, ...this.createDefaults }, relations: [], multilineFieldsFormat: {} };
    const failure = this.apply(item, operations);
    if (failure) return json(response, 400, failure);
    if (this.initialStateOnly && item.fields['System.State'] !== 'New') return json(response, 400, serviceError(`TF401320: Rule Error for field State. Error code: Required, HasValues, LimitedToValues, AllowsOldValue, InvalidEmpty.`, 'RuleValidationException'));
    store.set(id, item);
    this.touch(item);
    await this.afterWrite?.(item, 'create');
    json(response, 200, this.wire(organization, item));
  }

  private async update(response: ServerResponse, organization: string, item: FakeWorkItem, operations: Operation[]): Promise<void> {
    const test = operations.find(operation => operation.op === 'test' && operation.path === '/rev');
    if (test && test.value !== item.rev) return json(response, 412, serviceError(`TF26071: This work item has been changed by someone else since you opened it. You will need to refresh it and discard your changes.`, 'WorkItemRevisionMismatchException'));
    const copy = structuredClone(item);
    const failure = this.apply(copy, operations.filter(operation => operation.op !== 'test'));
    if (failure) return json(response, 400, failure);
    Object.assign(item, copy);
    this.touch(item);
    await this.afterWrite?.(item, 'update');
    json(response, 200, this.wire(organization, item));
  }

  /** Applies JSON Patch operations; the service's error body when one is invalid. */
  private apply(item: FakeWorkItem, operations: Operation[]): ReturnType<typeof serviceError> | null {
    for (const operation of operations) {
      const field = /^\/fields\/(.+)$/.exec(operation.path)?.[1];
      const format = /^\/multilineFieldsFormat\/(.+)$/.exec(operation.path)?.[1];
      const relation = /^\/relations\/(\d+|-)$/.exec(operation.path)?.[1];
      if (field && operation.op === 'remove' && !(field in item.fields)) return serviceError(`The remove operation for path /fields/${field} failed: the field has no value.`, 'WorkItemPatchException');
      if (field && operation.op === 'remove') delete item.fields[field];
      else if (field && (operation.op === 'add' || operation.op === 'replace')) item.fields[field] = operation.value;
      else if (format && operation.op === 'add') item.multilineFieldsFormat[format] = String(operation.value).toLowerCase();
      else if (relation === '-' && operation.op === 'add') item.relations.push(operation.value as FakeWorkItem['relations'][number]);
      else if (relation !== undefined && relation !== '-' && operation.op === 'remove') item.relations.splice(Number(relation), 1);
      else return serviceError(`Unsupported operation ${operation.op} ${operation.path}.`, 'WorkItemPatchException');
    }
    return null;
  }

  private wire(organization: string, item: FakeWorkItem) {
    return {
      id: item.id, rev: item.rev, fields: { ...item.fields }, relations: item.relations.map(relation => ({ ...relation })),
      ...(this.returnsFormats && Object.keys(item.multilineFieldsFormat).length > 0 ? { multilineFieldsFormat: { ...item.multilineFieldsFormat } } : {}),
      url: `${this.organization(organization)}/_apis/wit/workItems/${item.id}`,
    };
  }
}

interface Operation { op: string; path: string; value?: unknown }
