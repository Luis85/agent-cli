import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { MarkdownDataSourceDefinitions } from '../../src/plugins/data-sources/infrastructure/definitions.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';

const codec = new MarkdownDataSourceDefinitions(new ObsidianDocuments());
const base = { schemaVersion: 1, id: 'products', kind: 'rest', model: { name: 'Product', fields: { id: { type: 'string' }, name: { type: 'string' }, price: { type: 'number' }, available: { type: 'boolean', optional: true } } }, rest: { baseUrl: 'https://api.example.test/v1', operations: { list: { method: 'GET', path: '/products', responsePath: 'data.items' }, get: { method: 'GET', path: '/products/{id}' } } } };
const parse = (patch: Record<string, unknown> = {}) => codec.parse(new TextEncoder().encode(`---\n${stringify({ ...base, ...patch })}---\n# Products\n\nKeep **Markdown** and {{expressions}} intact.\n`), 'sources/products.md');

describe('Markdown data-source contract', () => {
  it('round-trips prose, REST operations, scalar schema and explicit fixtures', () => {
    const definition = parse({ testData: { records: [{ id: 'p-1', name: 'Hammer', price: 12.5 }] } });
    expect(definition.model.idField).toBe('id');
    expect(definition.description).toContain('**Markdown** and {{expressions}}');
    expect(codec.parse(codec.serialize(definition), definition.sourcePath)).toEqual(definition);
  });
  it('accepts local JSON and nullable enum fields with valid examples', () => {
    const definition = parse({ kind: 'json', rest: undefined, json: { path: 'data/products.json' }, model: { name: 'Product', fields: { id: { type: 'number' }, state: { type: 'string', nullable: true, enum: ['active', null], example: null } } } });
    expect(definition.json).toEqual({ path: 'data/products.json' });
    expect(definition.model.fields.state?.example).toBeNull();
  });
  it.each([
    { schemaVersion: 2 }, { extra: true }, { id: '../outside' }, { kind: 'graphql' },
    { model: { name: 'Bad Name', fields: {} } },
    { model: { name: 'Item', fields: { id: { type: 'boolean' } } } },
    { model: { name: 'Item', fields: { id: { type: 'string', optional: true } } } },
    { model: { name: 'Item', fields: { id: { type: 'string', nullable: true } } } },
    { model: { name: 'Item', fields: { id: { type: 'string' }, constructor: { type: 'string' } } } },
    { model: { name: 'Item', fields: { id: { type: 'string', enum: ['one'] } } } },
    { model: { name: 'Item', fields: { id: { type: 'string', example: '..' } } } },
    { model: { name: 'Item', fields: { id: { type: 'string', enum: ['', 'a', 'b'] } } } },
    { testData: { records: [{ id: '.', name: 'A', price: 1 }] } },
    { model: { name: 'Item', fields: { id: { type: 'number', example: 'wrong' } } } },
    { model: { name: 'Item', fields: { id: { type: 'string' }, state: { type: 'string', enum: ['yes', false] } } } },
    { model: { name: 'Item', fields: { id: { type: 'string' }, state: { type: 'string', enum: ['yes', 'yes'] } } } },
    { rest: undefined }, { json: { path: 'data/products.json' } },
    { kind: 'json', rest: undefined, json: { path: '../outside.json' } },
    { kind: 'json', rest: undefined, json: { path: 'data/items.js' } },
    { testData: { count: 0 } }, { testData: { count: 101 } }, { testData: { count: 2, records: [] } },
    { testData: { records: [{ id: 'x', name: 'A', price: 'wrong' }] } },
    { testData: { records: [{ id: 'x', name: 'A' }] } },
    { testData: { records: [{ id: 'x', name: 'A', price: 1, extra: 'unknown' }] } },
    { testData: { records: [{ id: 'x', name: 'A', price: 1 }, { id: 'x', name: 'B', price: 2 }] } },
  ] as Record<string, unknown>[])('rejects invalid definitions %#', patch => {
    expect(() => parse(patch)).toThrow(expect.objectContaining({ code: 'INVALID_DATA_SOURCE' }));
  });
  it.each([
    { baseUrl: 'file:///private' }, { baseUrl: 'https://name:password@example.test' }, { baseUrl: 'https://api.example.test?token=value' },
    { operations: {} }, { operations: { unknown: { method: 'GET', path: '/items' } } },
    { operations: { list: { method: 'POST', path: '/items' } } },
    { operations: { get: { method: 'GET', path: '/items' } } },
    { operations: { list: { method: 'GET', path: '/items/{id}' } } },
    { operations: { get: { method: 'GET', path: '/items/{other}' } } },
    { operations: { get: { method: 'GET', path: '/items/{id}/{id}' } } },
    { operations: { list: { method: 'GET', path: '//other.example/items' } } },
    { operations: { list: { method: 'GET', path: '/items/../admin' } } },
    { operations: { list: { method: 'GET', path: '/%2e%2e/admin' } } },
    { operations: { list: { method: 'GET', path: '/items/%zz' } } },
    { operations: { list: { method: 'GET', path: '/items?token=secret' } } },
    { operations: { list: { method: 'GET', path: '/items', responsePath: 'data.constructor' } } },
    { operations: { delete: { method: 'DELETE', path: '/items/{id}', responsePath: 'data' } } },
  ] as Record<string, unknown>[])('rejects unsupported REST configuration %#', rest => {
    expect(() => parse({ rest: { ...base.rest, ...rest } })).toThrow(expect.objectContaining({ code: 'INVALID_DATA_SOURCE' }));
  });
  it.each(['No frontmatter', '---\nid: one\nid: two\n---\n', '---\nmodel: &loop {fields: *loop}\n---\n', '---\nmodel: [\n---\n'])('rejects malformed or recursive Markdown YAML', text => {
    expect(() => codec.parse(new TextEncoder().encode(text), 'sources/bad.md')).toThrow(expect.objectContaining({ code: 'INVALID_DATA_SOURCE' }));
  });
});
