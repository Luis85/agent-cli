import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One work item as the fake stores it: Azure DevOps' wire shape. */
export interface FakeWorkItem {
  id: number; rev: number; fields: Record<string, unknown>;
  relations: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
  multilineFieldsFormat: Record<string, string>;
}
export interface FakeRequest { method: string; path: string; body: unknown }
type Relation = FakeWorkItem['relations'][number];

/** Work item link types and the reverse type the service records on the other end. */
const RECIPROCAL: Record<string, string> = {
  'System.LinkTypes.Hierarchy-Reverse': 'System.LinkTypes.Hierarchy-Forward', 'System.LinkTypes.Hierarchy-Forward': 'System.LinkTypes.Hierarchy-Reverse',
  'System.LinkTypes.Dependency-Reverse': 'System.LinkTypes.Dependency-Forward', 'System.LinkTypes.Dependency-Forward': 'System.LinkTypes.Dependency-Reverse',
  'System.LinkTypes.Related': 'System.LinkTypes.Related',
};
const PREDECESSOR = 'System.LinkTypes.Dependency-Reverse';
const targetId = (url: string) => Number(/\/workItems\/(\d+)$/i.exec(url)?.[1] ?? NaN);

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
 *
 * Work item links are stored on both ends: a relation added or removed on one item adds or removes the reverse
 * relation on its target (`Dependency-Reverse` on the successor is `Dependency-Forward` on the predecessor). Adding a
 * relation that already exists, or a dependency that closes a cycle, is refused with 400. The REST reference's update
 * history example records such link-only changes on the other item without a new revision, so by default the target
 * keeps its `rev`; `linksReviseTarget` makes them revise the target too, to prove the sync tolerates either.
 */
export class FakeAzureDevOps {
  readonly requests: FakeRequest[] = [];
  /** Reads include each item's `multilineFieldsFormat`. */
  returnsFormats = false;
  /** Creates refuse any state but the initial `New`, as processes with enforced state transitions do. */
  initialStateOnly = false;
  /** Fields a create applies when the request leaves them out, like process defaults and rules (for example a priority). */
  createDefaults: Record<string, unknown> = {};
  /** A link change also revises the item at the other end. */
  linksReviseTarget = false;
  /** Runs after each committed create or update, before the response is sent (to simulate concurrent changes). */
  afterWrite: ((item: FakeWorkItem, operation: 'create' | 'update') => void | Promise<void>) | null = null;
  /**
   * Runs when a create or update arrives, before the fake checks or applies it (to simulate a change made just before
   * the request, or a refusal). A returned message refuses the request with HTTP 400 and the service's error body.
   */
  beforeWrite: ((operation: 'create' | 'update', operations: ReadonlyArray<{ op: string; path: string; value?: unknown }>) => string | void) | null = null;
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
  /** A work item someone created in Azure DevOps, with these fields. */
  add(organization: string, fields: Record<string, unknown>): FakeWorkItem {
    const store = this.items.get(organization) ?? new Map<number, FakeWorkItem>();
    this.items.set(organization, store);
    const id = this.nextId.get(organization) ?? 1;
    this.nextId.set(organization, id + 1);
    const project = this.projects[organization] ?? organization;
    const item: FakeWorkItem = { id, rev: 0, fields: { 'System.State': 'New', 'System.AreaPath': project, 'System.IterationPath': project, 'System.TeamProject': project, ...fields }, relations: [], multilineFieldsFormat: {} };
    store.set(id, item);
    return this.touch(item);
  }
  /** Re-parents an item remotely. */
  reparent(organization: string, id: number, parent: number | null): FakeWorkItem {
    const item = this.item(organization, id);
    const index = item.relations.findIndex(relation => relation.rel === 'System.LinkTypes.Hierarchy-Reverse');
    if (index >= 0) this.unrelate(organization, item, index);
    if (parent !== null) this.relate(organization, item, { rel: 'System.LinkTypes.Hierarchy-Reverse', url: this.itemUrl(organization, parent) });
    return this.touch(item);
  }
  /** Someone links two items remotely (`rel` as seen from `id`, for example `System.LinkTypes.Dependency-Reverse` to a predecessor). */
  link(organization: string, id: number, rel: string, target: number): FakeWorkItem {
    const item = this.item(organization, id);
    const failure = this.relate(organization, item, { rel, url: this.itemUrl(organization, target) });
    if (failure) throw new Error(failure.message);
    return this.touch(item);
  }
  /** Someone removes a link remotely. */
  unlink(organization: string, id: number, rel: string, target: number): FakeWorkItem {
    const item = this.item(organization, id);
    this.unrelate(organization, item, item.relations.findIndex(relation => relation.rel === rel && targetId(relation.url) === target));
    return this.touch(item);
  }
  /** Ids of an item's predecessors. */
  predecessors(organization: string, id: number): number[] {
    return this.item(organization, id).relations.filter(relation => relation.rel === PREDECESSOR).map(relation => targetId(relation.url)).sort((a, b) => a - b);
  }

  private itemUrl(organization: string, id: number): string { return `${this.organization(organization)}/_apis/wit/workItems/${id}`; }

  /** Adds a relation and its reverse on the target; the service's error body when it is a duplicate or closes a dependency cycle. */
  private relate(organization: string, item: FakeWorkItem, relation: Relation): ReturnType<typeof serviceError> | null {
    if (item.relations.some(existing => existing.rel === relation.rel && existing.url.toLowerCase() === relation.url.toLowerCase())) return serviceError(`Relation already exists: ${relation.rel} to ${relation.url}.`, 'WorkItemLinkAlreadyExistsException');
    const reverse = RECIPROCAL[relation.rel];
    const target = reverse === undefined ? undefined : this.items.get(organization)?.get(targetId(relation.url));
    if (relation.rel === PREDECESSOR && target && (target.id === item.id || this.dependsOn(organization, target.id, item.id))) return serviceError(`The dependency on ${target.id} would create a cycle.`, 'WorkItemLinkCycleException');
    item.relations.push(relation);
    if (target && reverse) { target.relations.push({ rel: reverse, url: this.itemUrl(organization, item.id) }); this.linkChanged(target); }
    return null;
  }

  private unrelate(organization: string, item: FakeWorkItem, index: number): void {
    const [relation] = item.relations.splice(index, 1);
    const reverse = relation ? RECIPROCAL[relation.rel] : undefined;
    const target = relation && reverse ? this.items.get(organization)?.get(targetId(relation.url)) : undefined;
    if (!target) return;
    const back = target.relations.findIndex(entry => entry.rel === reverse && targetId(entry.url) === item.id);
    if (back >= 0) { target.relations.splice(back, 1); this.linkChanged(target); }
  }

  /** Whether `id` depends on `other`, directly or transitively. */
  private dependsOn(organization: string, id: number, other: number, seen = new Set<number>()): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    return this.predecessors(organization, id).some(predecessor => predecessor === other || this.dependsOn(organization, predecessor, other, seen));
  }

  private linkChanged(target: FakeWorkItem): void { if (this.linksReviseTarget) this.touch(target); }

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
    const refusal = this.beforeWrite?.('create', operations);
    if (typeof refusal === 'string') return json(response, 400, serviceError(refusal, 'RuleValidationException'));
    const id = this.nextId.get(organization) ?? 1;
    this.nextId.set(organization, id + 1);
    const item: FakeWorkItem = { id, rev: 0, fields: { 'System.WorkItemType': type, 'System.State': 'New', 'System.AreaPath': project, 'System.IterationPath': project, 'System.TeamProject': project, ...this.createDefaults }, relations: [], multilineFieldsFormat: {} };
    const saved = structuredClone(store);
    store.set(id, item);
    const rejected = this.apply(organization, item, operations)
      ?? (this.initialStateOnly && item.fields['System.State'] !== 'New' ? serviceError(`TF401320: Rule Error for field State. Error code: Required, HasValues, LimitedToValues, AllowsOldValue, InvalidEmpty.`, 'RuleValidationException') : null);
    if (rejected) { this.restore(store, saved); return json(response, 400, rejected); }
    this.touch(item);
    await this.afterWrite?.(item, 'create');
    json(response, 200, this.wire(organization, item));
  }

  private async update(response: ServerResponse, organization: string, item: FakeWorkItem, operations: Operation[]): Promise<void> {
    const refusal = this.beforeWrite?.('update', operations);
    if (typeof refusal === 'string') return json(response, 400, serviceError(refusal, 'RuleValidationException'));
    const test = operations.find(operation => operation.op === 'test' && operation.path === '/rev');
    if (test && test.value !== item.rev) return json(response, 412, serviceError(`TF26071: This work item has been changed by someone else since you opened it. You will need to refresh it and discard your changes.`, 'WorkItemRevisionMismatchException'));
    // Validate on a copy of the organization's items, so a refused patch changes neither end of any link.
    const store = this.items.get(organization)!, saved = structuredClone(store);
    const failure = this.apply(organization, item, operations.filter(operation => operation.op !== 'test'));
    if (failure) { this.restore(store, saved); return json(response, 400, failure); }
    this.touch(item);
    await this.afterWrite?.(item, 'update');
    json(response, 200, this.wire(organization, item));
  }

  /** Puts back every item as it was before a refused request (both ends of every link), keeping object identity. */
  private restore(store: Map<number, FakeWorkItem>, saved: Map<number, FakeWorkItem>): void {
    for (const id of store.keys()) if (!saved.has(id)) store.delete(id);
    for (const [id, item] of saved) Object.assign(store.get(id)!, item);
  }

  /** Applies JSON Patch operations; the service's error body when one is invalid. */
  private apply(organization: string, item: FakeWorkItem, operations: Operation[]): ReturnType<typeof serviceError> | null {
    for (const operation of operations) {
      const field = /^\/fields\/(.+)$/.exec(operation.path)?.[1];
      const format = /^\/multilineFieldsFormat\/(.+)$/.exec(operation.path)?.[1];
      const relation = /^\/relations\/(\d+|-)$/.exec(operation.path)?.[1];
      if (field && operation.op === 'remove' && !(field in item.fields)) return serviceError(`The remove operation for path /fields/${field} failed: the field has no value.`, 'WorkItemPatchException');
      if (field && operation.op === 'remove') delete item.fields[field];
      else if (field && (operation.op === 'add' || operation.op === 'replace')) item.fields[field] = operation.value;
      else if (format && operation.op === 'add') item.multilineFieldsFormat[format] = String(operation.value).toLowerCase();
      else if (relation === '-' && operation.op === 'add') { const refused = this.relate(organization, item, operation.value as Relation); if (refused) return refused; }
      else if (relation !== undefined && relation !== '-' && operation.op === 'remove') {
        if (Number(relation) >= item.relations.length) return serviceError(`The remove operation for path /relations/${relation} failed: no relation at that index.`, 'WorkItemPatchException');
        this.unrelate(organization, item, Number(relation));
      }
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
