import type { DataSourceDefinition, DataSourceField, DataSourceRecord, DataSourceValue } from '../domain/definition.ts';
import type { DataSourceGenerateOptions, DataSourceRenderer } from '../application/library.ts';
import type { WriteRequest } from '../../../domain/documents/file.ts';
import { vaultPath } from '../../../domain/documents/file.ts';

const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
function canonicalJson(value: unknown, spaces?: number): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([left], [right]) => compare(left, right)).map(([key, child]) => [key, normalize(child)]));
    return item;
  };
  return JSON.stringify(normalize(value), null, spaces);
}

function fieldType(field: DataSourceField): string {
  if (field.enum) return field.enum.map(value => JSON.stringify(value)).join(' | ');
  return `${field.type}${field.nullable ? ' | null' : ''}`;
}

function fixtureRecords(definition: DataSourceDefinition): DataSourceRecord[] {
  if (definition.testData?.records) return definition.testData.records;
  const ids = new Set<DataSourceValue>();
  return Array.from({ length: definition.testData?.count ?? 3 }, (_, index) => {
    const entries = Object.entries(definition.model.fields).sort(([left], [right]) => compare(left, right));
    return Object.fromEntries(entries.map(([name, field]) => {
      const primary = name === definition.model.idField;
      let value: DataSourceValue = field.example !== undefined ? field.example : field.enum ? field.enum[index % field.enum.length]! : field.type === 'string' ? `${name}-${index + 1}` : field.type === 'number' ? index + 1 : index % 2 === 0;
      if (primary) {
        if (field.enum) value = field.enum[index]!;
        else if (ids.has(value) && typeof value === 'string') value = `${value}-${index + 1}`;
        else if (ids.has(value)) { let candidate = index + 1; while (ids.has(candidate)) candidate++; value = candidate; }
        ids.add(value);
      }
      return [name, value];
    }));
  });
}

function modelSource(definition: DataSourceDefinition): string {
  const { name, fields, idField } = definition.model;
  const declarations = Object.entries(fields).sort(([left], [right]) => compare(left, right))
    .map(([key, field]) => `  ${JSON.stringify(key)}${field.optional ? '?' : ''}: ${fieldType(field)};`).join('\n');
  return `// Generated deterministically from ${definition.id}.md. No runtime dependencies.
export interface ${name} {
${declarations}
}
export type ${name}Id = ${name}[${JSON.stringify(idField)}];
export class ${name}DataSourceError extends globalThis.Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = ${JSON.stringify(`${name}DataSourceError`)}; }
}
const fields: { [key: string]: { type: string; optional?: boolean; nullable?: boolean; enum?: readonly unknown[] } } = ${canonicalJson(Object.fromEntries(Object.entries(fields).map(([key, { example: _example, ...field }]) => [key, field])), 2)};
function validateField(key: string, value: unknown): void {
  const field = fields[key];
  if (!field) throw new ${name}DataSourceError('Unknown field: ' + key);
  if (value === undefined && field.optional) return;
  if (value === null ? !field.nullable : typeof value !== field.type || (typeof value === 'number' && !globalThis.Number.isFinite(value))) {
    throw new ${name}DataSourceError('Invalid field: ' + key);
  }
  if (field.enum && !field.enum.includes(value)) throw new ${name}DataSourceError('Invalid enum field: ' + key);
}
function validateRecord(value: unknown, partial: boolean, strict = partial): void {
  if (value === null || typeof value !== 'object' || globalThis.Array.isArray(value)) throw new ${name}DataSourceError('Expected an object');
  const record = value as { [key: string]: unknown };
  if (strict) for (const key of globalThis.Object.keys(record)) if (!globalThis.Object.hasOwn(fields, key)) throw new ${name}DataSourceError('Unknown field: ' + key);
  for (const key of globalThis.Object.keys(fields)) {
    if (!partial || globalThis.Object.hasOwn(record, key)) validateField(key, globalThis.Object.hasOwn(record, key) ? record[key] : undefined);
  }
  if (!partial || globalThis.Object.hasOwn(record, ${JSON.stringify(idField)})) validate${name}Id(record[${JSON.stringify(idField)}] as ${name}Id);
}
export function validate${name}(value: unknown): ${name} { validateRecord(value, false); return value as ${name}; }
export function validate${name}Id(id: ${name}Id): void {
  validateField(${JSON.stringify(idField)}, id);
  if (typeof id === 'string' && ['', '.', '..'].includes(id)) throw new ${name}DataSourceError('ID cannot be empty or a dot path segment');
}
export function validate${name}List(value: unknown): ${name}[] {
  if (!globalThis.Array.isArray(value)) throw new ${name}DataSourceError('Expected an array of records');
  const records = value.map(item => validate${name}(item));
  const ids = new globalThis.Set(records.map(record => record[${JSON.stringify(idField)}]));
  if (ids.size !== records.length) throw new ${name}DataSourceError('Duplicate record IDs');
  return records;
}
`;
}

function restSource(definition: DataSourceDefinition): string {
  const { name } = definition.model;
  const rest = definition.rest!;
  const methods: string[] = [];
  for (const [operation, config] of Object.entries(rest.operations).sort(([left], [right]) => compare(left, right))) {
    const serialized = canonicalJson(config);
    const requestOptions = `requestOptions: { signal?: globalThis.AbortSignal } = {}`;
    if (operation === 'list') methods.push(`    async list(query: ${name}Query = {}, ${requestOptions}): globalThis.Promise<${name}[]> {
      return validate${name}List(await request(${serialized}, undefined, undefined, query, requestOptions.signal));
    }`);
    if (operation === 'get') methods.push(`    async get(id: ${name}Id, ${requestOptions}): globalThis.Promise<${name}> {
      validate${name}Id(id); return validate${name}(await request(${serialized}, id, undefined, undefined, requestOptions.signal));
    }`);
    if (operation === 'create') methods.push(`    async create(record: ${name}, ${requestOptions}): globalThis.Promise<${name}> {
      validateRecord(record, false, true); return validate${name}(await request(${serialized}, undefined, { ...record }, undefined, requestOptions.signal));
    }`);
    if (operation === 'update') methods.push(`    async update(id: ${name}Id, patch: ${config.method === 'PUT' ? name : `{ [Key in keyof ${name}]?: ${name}[Key] }`}, ${requestOptions}): globalThis.Promise<${name}> {
      validate${name}Id(id); validateRecord(patch, ${config.method !== 'PUT'}, true); return validate${name}(await request(${serialized}, id, { ...patch }, undefined, requestOptions.signal));
    }`);
    if (operation === 'delete') methods.push(`    async delete(id: ${name}Id, ${requestOptions}): globalThis.Promise<void> {
      validate${name}Id(id); await request(${serialized}, id, undefined, undefined, requestOptions.signal);
    }`);
  }
  return `export interface ${name}Query { [key: string]: string | number | boolean | readonly (string | number | boolean)[] | undefined }
export interface ${name}DataSourceOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  headers?: globalThis.HeadersInit;
}
export function create${name}DataSource(options: ${name}DataSourceOptions = {}) {
  const base = new globalThis.URL(options.baseUrl ?? ${JSON.stringify(rest.baseUrl)});
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new ${name}DataSourceError('Expected an HTTP(S) base URL without credentials, query or fragment');
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  async function request(operation: { method: string; path: string; responsePath?: string }, id?: ${name}Id, body?: unknown, query?: ${name}Query, signal?: globalThis.AbortSignal): globalThis.Promise<unknown> {
    const path = operation.path.replace('{id}', globalThis.encodeURIComponent(globalThis.String(id)));
    const url = new globalThis.URL(base.href);
    url.pathname = base.pathname.replace(/\\/$/, '') + path;
    for (const key of globalThis.Object.keys(query ?? {}).sort()) {
      const item = query![key];
      if (item !== undefined) for (const value of globalThis.Array.isArray(item) ? item : [item]) url.searchParams.append(key, globalThis.String(value));
    }
    const headers = new globalThis.Headers(options.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetcher(url, { method: operation.method, headers, signal, ...(body === undefined ? {} : { body: globalThis.JSON.stringify(body) }) });
    if (!response.ok) throw new ${name}DataSourceError('HTTP ' + response.status + ' ' + response.statusText, response.status);
    if (operation.method === 'DELETE') return undefined;
    let value: unknown;
    try { value = await response.json(); } catch { throw new ${name}DataSourceError('Expected a JSON response', response.status); }
    for (const key of operation.responsePath?.split('.') ?? []) {
      if (value === null || typeof value !== 'object' || !globalThis.Object.hasOwn(value, key)) throw new ${name}DataSourceError('Missing response path: ' + operation.responsePath, response.status);
      value = (value as { [key: string]: unknown })[key];
    }
    return value;
  }
  return {
${methods.join(',\n')}
  };
}
`;
}

function jsonSource(definition: DataSourceDefinition): string {
  const { name, idField } = definition.model;
  return `export interface ${name}DataSourceOptions {
  /** Read and parse the configured local JSON file using your runtime's filesystem or asset loader. */
  loadJson(path: string): globalThis.Promise<unknown>;
  path?: string;
}
export function create${name}DataSource(options: ${name}DataSourceOptions) {
  const path = options.path ?? ${JSON.stringify(definition.json!.path)};
  return {
    async list(): globalThis.Promise<${name}[]> { return validate${name}List(await options.loadJson(path)); },
    async get(id: ${name}Id): globalThis.Promise<${name}> {
      validate${name}Id(id);
      const record = validate${name}List(await options.loadJson(path)).find(item => item[${JSON.stringify(idField)}] === id);
      if (!record) throw new ${name}DataSourceError('Record not found: ' + id, 404);
      return record;
    },
  };
}
`;
}

export class TypeScriptDataSourceRenderer implements DataSourceRenderer {
  generate(definitions: readonly DataSourceDefinition[], options: DataSourceGenerateOptions): readonly WriteRequest[] {
    vaultPath(options.outputDirectory); vaultPath(options.testDataDirectory);
    return [...definitions].sort((left, right) => compare(left.id, right.id)).flatMap(definition => [
      { path: `${options.outputDirectory}/${definition.id}.ts`, bytes: new TextEncoder().encode(modelSource(definition) + (definition.kind === 'rest' ? restSource(definition) : jsonSource(definition))) },
      { path: `${options.testDataDirectory}/${definition.id}.fixtures.json`, bytes: new TextEncoder().encode(canonicalJson(fixtureRecords(definition), 2) + '\n') },
    ]);
  }
}
