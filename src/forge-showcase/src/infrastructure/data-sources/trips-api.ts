// Generated deterministically from trips-api.md. No runtime dependencies.
export interface TripRecord {
  "destination": string;
  "favorite": boolean;
  "id": string;
  "nights": number;
  "notes"?: string | null;
  "status": "planned" | "booked" | "completed";
  "title": string;
}
export type TripRecordId = TripRecord["id"];
export class TripRecordDataSourceError extends globalThis.Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = "TripRecordDataSourceError"; }
}
const fields: { [key: string]: { type: string; optional?: boolean; nullable?: boolean; enum?: readonly unknown[] } } = {
  "destination": {
    "type": "string"
  },
  "favorite": {
    "type": "boolean"
  },
  "id": {
    "type": "string"
  },
  "nights": {
    "type": "number"
  },
  "notes": {
    "nullable": true,
    "optional": true,
    "type": "string"
  },
  "status": {
    "enum": [
      "planned",
      "booked",
      "completed"
    ],
    "type": "string"
  },
  "title": {
    "type": "string"
  }
};
function validateField(key: string, value: unknown): void {
  const field = fields[key];
  if (!field) throw new TripRecordDataSourceError('Unknown field: ' + key);
  if (value === undefined && field.optional) return;
  if (value === null ? !field.nullable : typeof value !== field.type || (typeof value === 'number' && !globalThis.Number.isFinite(value))) {
    throw new TripRecordDataSourceError('Invalid field: ' + key);
  }
  if (field.enum && !field.enum.includes(value)) throw new TripRecordDataSourceError('Invalid enum field: ' + key);
}
function validateRecord(value: unknown, partial: boolean, strict = partial): void {
  if (value === null || typeof value !== 'object' || globalThis.Array.isArray(value)) throw new TripRecordDataSourceError('Expected an object');
  const record = value as { [key: string]: unknown };
  if (strict) for (const key of globalThis.Object.keys(record)) if (!globalThis.Object.hasOwn(fields, key)) throw new TripRecordDataSourceError('Unknown field: ' + key);
  for (const key of globalThis.Object.keys(fields)) {
    if (!partial || globalThis.Object.hasOwn(record, key)) validateField(key, globalThis.Object.hasOwn(record, key) ? record[key] : undefined);
  }
  if (!partial || globalThis.Object.hasOwn(record, "id")) validateTripRecordId(record["id"] as TripRecordId);
}
export function validateTripRecord(value: unknown): TripRecord { validateRecord(value, false); return value as TripRecord; }
export function validateTripRecordId(id: TripRecordId): void {
  validateField("id", id);
  if (typeof id === 'string' && ['', '.', '..'].includes(id)) throw new TripRecordDataSourceError('ID cannot be empty or a dot path segment');
}
export function validateTripRecordList(value: unknown): TripRecord[] {
  if (!globalThis.Array.isArray(value)) throw new TripRecordDataSourceError('Expected an array of records');
  const records = value.map(item => validateTripRecord(item));
  const ids = new globalThis.Set(records.map(record => record["id"]));
  if (ids.size !== records.length) throw new TripRecordDataSourceError('Duplicate record IDs');
  return records;
}
export interface TripRecordQuery { [key: string]: string | number | boolean | readonly (string | number | boolean)[] | undefined }
export interface TripRecordDataSourceOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  headers?: globalThis.HeadersInit;
}
export function createTripRecordDataSource(options: TripRecordDataSourceOptions = {}) {
  const base = new globalThis.URL(options.baseUrl ?? "https://api.trailhead.example/v1");
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new TripRecordDataSourceError('Expected an HTTP(S) base URL without credentials, query or fragment');
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  async function request(operation: { method: string; path: string; responsePath?: string }, id?: TripRecordId, body?: unknown, query?: TripRecordQuery, signal?: globalThis.AbortSignal): globalThis.Promise<unknown> {
    const path = operation.path.replace('{id}', globalThis.encodeURIComponent(globalThis.String(id)));
    const url = new globalThis.URL(base.href);
    url.pathname = base.pathname.replace(/\/$/, '') + path;
    for (const key of globalThis.Object.keys(query ?? {}).sort()) {
      const item = query![key];
      if (item !== undefined) for (const value of globalThis.Array.isArray(item) ? item : [item]) url.searchParams.append(key, globalThis.String(value));
    }
    const headers = new globalThis.Headers(options.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetcher(url, { method: operation.method, headers, signal, ...(body === undefined ? {} : { body: globalThis.JSON.stringify(body) }) });
    if (!response.ok) throw new TripRecordDataSourceError('HTTP ' + response.status + ' ' + response.statusText, response.status);
    if (operation.method === 'DELETE') return undefined;
    let value: unknown;
    try { value = await response.json(); } catch { throw new TripRecordDataSourceError('Expected a JSON response', response.status); }
    for (const key of operation.responsePath?.split('.') ?? []) {
      if (value === null || typeof value !== 'object' || !globalThis.Object.hasOwn(value, key)) throw new TripRecordDataSourceError('Missing response path: ' + operation.responsePath, response.status);
      value = (value as { [key: string]: unknown })[key];
    }
    return value;
  }
  return {
    async create(record: TripRecord, requestOptions: { signal?: globalThis.AbortSignal } = {}): globalThis.Promise<TripRecord> {
      validateRecord(record, false, true); return validateTripRecord(await request({"method":"POST","path":"/trips"}, undefined, { ...record }, undefined, requestOptions.signal));
    },
    async delete(id: TripRecordId, requestOptions: { signal?: globalThis.AbortSignal } = {}): globalThis.Promise<void> {
      validateTripRecordId(id); await request({"method":"DELETE","path":"/trips/{id}"}, id, undefined, undefined, requestOptions.signal);
    },
    async get(id: TripRecordId, requestOptions: { signal?: globalThis.AbortSignal } = {}): globalThis.Promise<TripRecord> {
      validateTripRecordId(id); return validateTripRecord(await request({"method":"GET","path":"/trips/{id}"}, id, undefined, undefined, requestOptions.signal));
    },
    async list(query: TripRecordQuery = {}, requestOptions: { signal?: globalThis.AbortSignal } = {}): globalThis.Promise<TripRecord[]> {
      return validateTripRecordList(await request({"method":"GET","path":"/trips","responsePath":"data.items"}, undefined, undefined, query, requestOptions.signal));
    },
    async update(id: TripRecordId, patch: { [Key in keyof TripRecord]?: TripRecord[Key] }, requestOptions: { signal?: globalThis.AbortSignal } = {}): globalThis.Promise<TripRecord> {
      validateTripRecordId(id); validateRecord(patch, true, true); return validateTripRecord(await request({"method":"PATCH","path":"/trips/{id}"}, id, { ...patch }, undefined, requestOptions.signal));
    }
  };
}
