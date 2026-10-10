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
const read = (request: IncomingMessage) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = [];
  request.on('data', chunk => chunks.push(chunk as Buffer));
  request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  request.on('error', reject);
});

/**
 * An in-process fake of the Azure DevOps Work Items REST API (api-version 7.1) for the endpoints the connector
 * uses: project probe, WIQL (ChangedDate, AreaPath UNDER and Id IN subsets), workitemsbatch, create, get and update
 * with JSON Patch. Revisions increase on every write and a failed `test /rev` answers 412, like the service. Each
 * organization (`/<org>/`) holds its own items; every request needs `Authorization: Basic base64(":" + pat)`.
 */
export class FakeAzureDevOps {
  readonly requests: FakeRequest[] = [];
  private readonly items = new Map<string, Map<number, FakeWorkItem>>();
  private readonly nextId = new Map<string, number>();
  private clock = Date.UTC(2026, 9, 1);
  private throttle = 0;
  private server = createServer((request, response) => { void this.handle(request, response); });
  base = '';

  constructor(readonly pat: string, readonly projects: Record<string, string> = {}) {}

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
    if (request.method === 'POST' && rest === '_apis/wit/wiql') return json(response, 200, { workItems: this.wiql(store, String((body as { query?: string })?.query ?? '')).map(id => ({ id })) });
    if (request.method === 'POST' && rest === '_apis/wit/workitemsbatch') {
      const ids = (body as { ids: number[] }).ids;
      return json(response, 200, { count: ids.length, value: ids.map(id => (store.has(id) ? this.wire(organization!, store.get(id)!) : null)).filter(Boolean) });
    }
    const create = /^_apis\/wit\/workitems\/\$(.+)$/.exec(rest);
    if (request.method === 'POST' && create) return this.create(response, organization!, project, store, create[1]!, body as Operation[]);
    const single = /^_apis\/wit\/workitems\/(\d+)$/.exec(rest);
    const item = single ? store.get(Number(single[1])) : undefined;
    if (single && !item) return json(response, 404, { message: `TF401232: Work item ${single[1]} does not exist.` });
    if (request.method === 'GET' && item) return json(response, 200, this.wire(organization!, item));
    if (request.method === 'PATCH' && item) return this.update(response, organization!, item, body as Operation[]);
    json(response, 404, { message: `No route for ${request.method} ${url.pathname}` });
  }

  private project(response: ServerResponse, organization: string, project: string): void {
    if (this.projects[organization] !== undefined && this.projects[organization] !== project) return json(response, 404, { message: `Project ${project} does not exist.` });
    json(response, 200, { id: `${organization}-${project}-id`, name: project, state: 'wellFormed', capabilities: { processTemplate: { templateName: 'Agile' } } });
  }

  private wiql(store: Map<number, FakeWorkItem>, query: string): number[] {
    const since = /\[System\.ChangedDate\]\s*>=\s*'([^']*)'/.exec(query)?.[1];
    const area = /\[System\.AreaPath\]\s*UNDER\s*'((?:[^']|'')*)'/.exec(query)?.[1]?.replaceAll("''", "'");
    const ids = /\[System\.Id\]\s*IN\s*\(([^)]*)\)/.exec(query)?.[1]?.split(',').map(id => Number(id.trim()));
    return [...store.values()].filter(item => (since === undefined || String(item.fields['System.ChangedDate']) >= since)
      && (area === undefined || String(item.fields['System.AreaPath'] ?? '').toLowerCase().startsWith(area.toLowerCase()))
      && (ids === undefined || ids.includes(item.id))).map(item => item.id).sort((a, b) => a - b);
  }

  private create(response: ServerResponse, organization: string, project: string, store: Map<number, FakeWorkItem>, type: string, operations: Operation[]): void {
    const id = this.nextId.get(organization) ?? 1;
    this.nextId.set(organization, id + 1);
    const item: FakeWorkItem = { id, rev: 0, fields: { 'System.WorkItemType': type, 'System.State': 'New', 'System.AreaPath': project, 'System.IterationPath': project, 'System.TeamProject': project }, relations: [], multilineFieldsFormat: {} };
    const failure = this.apply(item, operations);
    if (failure) return json(response, 400, { message: failure });
    store.set(id, item);
    json(response, 200, this.wire(organization, this.touch(item)));
  }

  private update(response: ServerResponse, organization: string, item: FakeWorkItem, operations: Operation[]): void {
    const test = operations.find(operation => operation.op === 'test' && operation.path === '/rev');
    if (test && test.value !== item.rev) return json(response, 412, { message: `TF26071: This work item has been changed by someone else since you opened it. Expected rev ${String(test.value)}, found ${item.rev}.` });
    const copy = structuredClone(item);
    const failure = this.apply(copy, operations.filter(operation => operation.op !== 'test'));
    if (failure) return json(response, 400, { message: failure });
    Object.assign(item, copy);
    json(response, 200, this.wire(organization, this.touch(item)));
  }

  private apply(item: FakeWorkItem, operations: Operation[]): string | null {
    for (const operation of operations) {
      const field = /^\/fields\/(.+)$/.exec(operation.path)?.[1];
      const format = /^\/multilineFieldsFormat\/(.+)$/.exec(operation.path)?.[1];
      const relation = /^\/relations\/(\d+|-)$/.exec(operation.path)?.[1];
      if (field && operation.op === 'remove') delete item.fields[field];
      else if (field && (operation.op === 'add' || operation.op === 'replace')) item.fields[field] = operation.value;
      else if (format && operation.op === 'add') item.multilineFieldsFormat[format] = String(operation.value).toLowerCase();
      else if (relation === '-' && operation.op === 'add') item.relations.push(operation.value as FakeWorkItem['relations'][number]);
      else if (relation !== undefined && relation !== '-' && operation.op === 'remove') item.relations.splice(Number(relation), 1);
      else return `Unsupported operation ${operation.op} ${operation.path}`;
    }
    return null;
  }

  private wire(organization: string, item: FakeWorkItem) {
    return {
      id: item.id, rev: item.rev, fields: { ...item.fields }, relations: item.relations.map(relation => ({ ...relation })),
      ...(Object.keys(item.multilineFieldsFormat).length > 0 ? { multilineFieldsFormat: { ...item.multilineFieldsFormat } } : {}),
      url: `${this.organization(organization)}/_apis/wit/workItems/${item.id}`,
    };
  }
}

interface Operation { op: string; path: string; value?: unknown }
