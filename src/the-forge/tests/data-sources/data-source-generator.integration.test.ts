import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import type { DataSourceDefinition, DataSourceRecord } from '../../src/domain/data-sources/definition.ts';
import { MarkdownDataSourceDefinitions } from '../../src/infrastructure/data-sources/definitions.ts';
import { TypeScriptDataSourceRenderer } from '../../src/infrastructure/data-sources/generator.ts';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const renderer = new TypeScriptDataSourceRenderer();
const codec = new MarkdownDataSourceDefinitions();
const options = { outputDirectory: 'custom/adapters', testDataDirectory: 'custom/test-data' };
const source: DataSourceDefinition = {
  schemaVersion: 1, id: 'tasks', kind: 'rest', description: 'Task service.', sourcePath: 'sources/tasks.md',
  model: { name: 'Task', idField: 'id', fields: {
    id: { type: 'string', example: 'task-1' }, title: { type: 'string', example: 'Plan' },
    done: { type: 'boolean' }, score: { type: 'number', optional: true },
    status: { type: 'string', enum: ['draft', 'ready'] }, notes: { type: 'string', nullable: true, example: null },
  } },
  rest: { baseUrl: 'https://example.test/api/v1', operations: {
    list: { method: 'GET', path: '/tasks', responsePath: 'data.items' },
    get: { method: 'GET', path: '/tasks/{id}', responsePath: 'data' },
    create: { method: 'POST', path: '/tasks' }, update: { method: 'PATCH', path: '/tasks/{id}' },
    delete: { method: 'DELETE', path: '/tasks/{id}' },
  } },
};
const jsonSource: DataSourceDefinition = { ...source, id: 'local-tasks', kind: 'json', rest: undefined, json: { path: 'data/tasks.json' } };
const record = { id: 'task-1', title: 'Plan', done: false, status: 'draft', notes: null };
type RuntimeOptions = { fetch?: typeof fetch; baseUrl?: string; headers?: HeadersInit; loadJson?: (path: string) => Promise<unknown>; path?: string };
interface Adapter {
  list(query?: object, options?: { signal?: AbortSignal }): Promise<DataSourceRecord[]>;
  get(id: string | number): Promise<DataSourceRecord>;
  create(record: object): Promise<DataSourceRecord>;
  update(id: string | number, record: object): Promise<DataSourceRecord>;
  delete(id: string | number): Promise<void>;
}
async function generated(definition = source) {
  const normalized = codec.parse(codec.serialize(definition), definition.sourcePath);
  const files = renderer.generate([normalized], options);
  const code = ts.transpileModule(new TextDecoder().decode(files[0]!.bytes), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const module = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return {
    create: module[`create${definition.model.name}DataSource`] as (options: RuntimeOptions) => Adapter,
    validate: module[`validate${definition.model.name}`] as (value: unknown) => DataSourceRecord,
    fixtures: JSON.parse(new TextDecoder().decode(files[1]!.bytes)) as DataSourceRecord[],
    files,
  };
}

it('typechecks dependency-free REST and JSON adapters, restricted operation sets and builtin model names under strict settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-data-compile-')); temporary.push(directory);
  const roots: string[] = [];
  const variants: DataSourceDefinition[] = [
    { ...source, id: 'numeric-id', model: { ...source.model, fields: { ...source.model.fields, id: { type: 'number' } } } },
    { ...source, id: 'numeric-enum-id', model: { ...source.model, fields: { ...source.model.fields, id: { type: 'number', enum: [1, 2, 3] } } } },
    { ...source, id: 'string-enum-id', model: { ...source.model, fields: { ...source.model.fields, id: { type: 'string', enum: ['a', 'b', 'c'] } } } },
    { ...source, id: 'put-update', rest: { ...source.rest!, operations: { update: { method: 'PUT', path: '/tasks/{id}' } } } },
  ];
  const definitions = [source, jsonSource, ...variants, ...variants.map(definition => ({ ...definition, kind: 'json' as const, id: `${definition.id}-json`, rest: undefined, json: jsonSource.json })), ...['Number', 'Promise', 'Object', 'RequestInit', 'URL', 'Set'].map((name, index) => ({
    ...source, id: `model-${index}`, model: { ...source.model, name }, rest: { ...source.rest!, operations: { list: source.rest!.operations.list } },
  })), { ...source, id: 'get-only', rest: { ...source.rest!, operations: { get: source.rest!.operations.get } } }];
  for (const file of renderer.generate(definitions, options).filter(file => file.path.endsWith('.ts'))) {
    const path = join(directory, file.path); roots.push(path);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.bytes);
  }
  const program = ts.createProgram(roots, {
    strict: true, noEmit: true, noUnusedLocals: true, noUnusedParameters: true, noUncheckedIndexedAccess: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, types: [], skipLibCheck: true,
  });
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic => `${diagnostic.file?.fileName}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)).toEqual([]);
}, 30000);

it('requests configured REST operations, preserves base URL paths and safely encodes IDs and query values', async () => {
  const { create } = await generated();
  const requests: { url: URL; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (init?.method === 'GET') return Response.json(requests.length === 1 ? { data: { items: [record] } } : { data: record });
    return Response.json(record);
  };
  const adapter = create({ fetch: fetcher, baseUrl: 'https://other.test/root/', headers: { Authorization: 'Bearer injected' } });
  const controller = new AbortController();
  expect(await adapter.list({ q: 'a & b', tags: ['a/b', 'c'], omitted: undefined, limit: 2 }, { signal: controller.signal })).toEqual([record]);
  expect(await adapter.get('a/b ?#')).toEqual(record);
  expect(await adapter.create(record)).toEqual(record);
  expect(await adapter.update('task-1', { title: 'Updated' })).toEqual(record);
  await expect(adapter.delete('task-1')).resolves.toBeUndefined();
  expect(requests[0]!.url.href).toBe('https://other.test/root/tasks?limit=2&q=a+%26+b&tags=a%2Fb&tags=c');
  expect(requests[0]!.init?.signal).toBe(controller.signal);
  expect(requests[1]!.url.pathname).toBe('/root/tasks/a%2Fb%20%3F%23');
  expect(requests.map(request => request.init?.method)).toEqual(['GET', 'GET', 'POST', 'PATCH', 'DELETE']);
  expect(new Headers(requests[2]!.init?.headers).get('authorization')).toBe('Bearer injected');
  expect(new Headers(requests[2]!.init?.headers).get('content-type')).toBe('application/json');
  expect(JSON.parse(requests[2]!.init!.body as string)).toEqual(record);
  expect(JSON.parse(requests[3]!.init!.body as string)).toEqual({ title: 'Updated' });
});

it('rejects malformed requests, bad HTTP responses, invalid JSON, missing envelopes and invalid model responses', async () => {
  const { create, validate } = await generated();
  let calls = 0;
  const adapter = create({ fetch: async () => { calls++; return Response.json(record); } });
  await expect(adapter.create({ ...record, done: 'false' })).rejects.toThrow('Invalid field: done');
  await expect(adapter.create({ ...record, admin: true })).rejects.toThrow('Unknown field: admin');
  await expect(adapter.update('task-1', { status: 'unknown' })).rejects.toThrow('Invalid enum field: status');
  await expect(adapter.update('task-1', { unknown: 'field' })).rejects.toThrow('Unknown field: unknown');
  await expect(adapter.get('..')).rejects.toThrow('dot path');
  await expect(adapter.get(1)).rejects.toThrow('Invalid field: id');
  expect(calls).toBe(0);
  expect(() => validate({ ...record, score: Infinity })).toThrow('Invalid field: score');
  expect(() => validate({ ...record, notes: 1 })).toThrow('Invalid field: notes');
  expect(() => validate({ ...record, id: '.' })).toThrow('dot path');
  expect(validate({ ...record, metadata: 'Server extension' })).toMatchObject(record);
  expect(() => create({ baseUrl: 'file:///tmp/data' })).toThrow('HTTP(S)');
  await expect(create({ fetch: async () => new Response('Oops', { status: 503, statusText: 'Unavailable' }) }).list()).rejects.toMatchObject({ status: 503, message: 'HTTP 503 Unavailable' });
  await expect(create({ fetch: async () => new Response('<html>') }).list()).rejects.toThrow('Expected a JSON response');
  await expect(create({ fetch: async () => Response.json({ items: [] }) }).list()).rejects.toThrow('Missing response path');
  await expect(create({ fetch: async () => Response.json({ data: { items: [record, record] } }) }).list()).rejects.toThrow('Duplicate record IDs');
  await expect(create({ fetch: async () => Response.json({ data: { ...record, done: null } }) }).get('task-1')).rejects.toThrow('Invalid field: done');
  await expect(create({ fetch: async () => { throw new Error('Network offline'); } }).list()).rejects.toThrow('Network offline');
});

it('requires complete PUT replacement payloads while PATCH accepts partial updates', async () => {
  const definition: DataSourceDefinition = { ...source, rest: { ...source.rest!, operations: { update: { method: 'PUT', path: '/tasks/{id}' } } } };
  const { create } = await generated(definition);
  const bodies: unknown[] = [];
  const adapter = create({ fetch: async (_input, init) => { bodies.push(JSON.parse(init!.body as string)); return Response.json(record); } });
  await expect(adapter.update(record.id, { title: 'Incomplete replacement' })).rejects.toThrow('Invalid field');
  await expect(adapter.update(record.id, { ...record, admin: true })).rejects.toThrow('Unknown field: admin');
  expect(bodies).toEqual([]);
  await expect(adapter.update(record.id, record)).resolves.toEqual(record);
  expect(bodies).toEqual([record]);
});

it('loads and validates the real configured JSON file through an injected loader without fixture substitution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-local-data-')); temporary.push(directory);
  const { create } = await generated(jsonSource);
  await mkdir(join(directory, 'data'));
  await writeFile(join(directory, 'data/tasks.json'), JSON.stringify([record]));
  const loadedPaths: string[] = [];
  const adapter = create({ loadJson: async path => { loadedPaths.push(path); return JSON.parse(await readFile(join(directory, path), 'utf8')); } });
  expect(await adapter.list()).toEqual([record]);
  expect(await adapter.get('task-1')).toEqual(record);
  await expect(adapter.get('missing')).rejects.toMatchObject({ status: 404 });
  expect(loadedPaths).toEqual(['data/tasks.json', 'data/tasks.json', 'data/tasks.json']);
  await writeFile(join(directory, 'data/tasks.json'), JSON.stringify([{ ...record, title: 'Changed after generation' }]));
  expect((await adapter.list())[0]!.title).toBe('Changed after generation');
  expect(Object.keys(adapter).sort()).toEqual(['get', 'list']);
  await expect(create({ loadJson: async () => ({ records: [record] }) }).list()).rejects.toThrow('Expected an array');
  await expect(create({ loadJson: async () => [{ id: 'missing-fields' }] }).list()).rejects.toThrow('Invalid field');
  await expect(create({ loadJson: async () => [record, record] }).list()).rejects.toThrow('Duplicate record IDs');
  const paths: string[] = [];
  await create({ path: 'overridden.json', loadJson: async path => { paths.push(path); return []; } }).list();
  expect(paths).toEqual(['overridden.json']);
});

it('generates stable schema-valid examples and explicit records only in configured artifact folders', async () => {
  const { fixtures, validate, files } = await generated();
  expect(files.map(file => file.path)).toEqual(['custom/adapters/tasks.ts', 'custom/test-data/tasks.fixtures.json']);
  expect(fixtures).toHaveLength(3);
  expect(fixtures.map(value => validate(value))).toEqual(fixtures);
  expect(new Set(fixtures.map(value => value.id)).size).toBe(3);
  expect(fixtures[0]).toMatchObject({ id: 'task-1', title: 'Plan', notes: null });
  expect(renderer.generate([source, jsonSource], options)).toEqual(renderer.generate([jsonSource, source], options));
  expect(renderer.generate([source], options)).toEqual(renderer.generate([source], options));
  const reordered: DataSourceDefinition = {
    ...source,
    model: { ...source.model, fields: Object.fromEntries(Object.entries(source.model.fields).reverse().map(([key, value]) => [key, Object.fromEntries(Object.entries(value).reverse()) as typeof value])) },
    rest: { ...source.rest!, operations: Object.fromEntries(Object.entries(source.rest!.operations).reverse().map(([key, value]) => [key, Object.fromEntries(Object.entries(value).reverse())])) },
  };
  expect(renderer.generate([source], options)).toEqual(renderer.generate([reordered], options));
  const explicit = await generated({ ...source, testData: { records: [record] } });
  expect(explicit.fixtures).toEqual([record]);
  const numeric = await generated({ ...source, model: { ...source.model, fields: { ...source.model.fields, id: { type: 'number', example: 2 } } }, testData: { count: 5 } });
  expect(numeric.fixtures).toHaveLength(5);
  expect(new Set(numeric.fixtures.map(value => value.id)).size).toBe(5);
  const enumerated = await generated({ ...source, model: { ...source.model, fields: { ...source.model.fields, id: { type: 'string', enum: ['a', 'b', 'c'] } } } });
  expect(enumerated.fixtures.map(value => value.id)).toEqual(['a', 'b', 'c']);
  const nullableEnum = await generated({ ...source, model: { ...source.model, fields: { ...source.model.fields, notes: { type: 'string', nullable: true, enum: [null, 'Example'] } } } });
  expect(nullableEnum.fixtures.map(value => nullableEnum.validate(value).notes)).toEqual([null, 'Example', null]);
});
