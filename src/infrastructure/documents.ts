import { parseDocument, stringify, isMap, type Document } from 'yaml';
import { ensure, isRecord } from '../domain/errors.ts';
import { fileKind } from '../domain/file.ts';
import { validateCanvas } from '../domain/canvas.ts';
import type { DocumentCodec } from '../application/ports.ts';

const encode = (text: string) => new TextEncoder().encode(text);
function textOf(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('Structured documents must be valid UTF-8.'); }
}
function yamlDocument(text: string): Document {
  const document = parseDocument(text, { uniqueKeys: true });
  ensure(!document.errors.length, 'INVALID_YAML', document.errors.map(e => e.message).join('; '));
  return document;
}
function frontmatter(text: string) {
  const prefix = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  text = text.slice(prefix.length);
  if (!/^---\r?\n/.test(text)) return { yaml: '', body: text, newline: '\n', exists: false, prefix };
  const match = /^---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(text);
  ensure(match?.index === 0, 'INVALID_FRONTMATTER', 'Unclosed YAML frontmatter.');
  return { yaml: match[1]!, body: text.slice(match[0].length), newline: text.startsWith('---\r\n') ? '\r\n' : '\n', exists: true, prefix };
}
function validateBase(value: unknown) {
  ensure(isRecord(value), 'INVALID_BASE', 'A Base must contain a YAML mapping.');
  for (const key of ['formulas', 'properties', 'summaries']) ensure(value[key] === undefined || isRecord(value[key]), 'INVALID_BASE', `${key} must be a mapping.`);
  for (const key of ['formulas', 'summaries']) ensure(value[key] === undefined || Object.values(value[key] as Record<string, unknown>).every(v => typeof v === 'string'), 'INVALID_BASE', `${key} values must be expressions stored as strings.`);
  ensure(value.views === undefined || (Array.isArray(value.views) && value.views.every(v => isRecord(v) && typeof v.type === 'string' && typeof v.name === 'string')), 'INVALID_BASE', 'Views need type and name strings.');
  const filter = (f: unknown, depth = 0): boolean => depth < 100 && (typeof f === 'string' || (isRecord(f) && Object.keys(f).length === 1 && Object.entries(f).every(([k, v]) => ['and', 'or', 'not'].includes(k) && Array.isArray(v) && v.every(child => filter(child, depth + 1)))));
  ensure(value.filters === undefined || filter(value.filters), 'INVALID_BASE', 'Invalid filter structure.');
  for (const view of (value.views ?? []) as Record<string, unknown>[]) {
    ensure(view.filters === undefined || filter(view.filters), 'INVALID_BASE', 'Invalid view filter structure.');
    ensure(view.order === undefined || (Array.isArray(view.order) && view.order.every(v => typeof v === 'string')), 'INVALID_BASE', 'View order must be a list of property names.');
    ensure(view.limit === undefined || (Number.isInteger(view.limit) && Number(view.limit) >= 0), 'INVALID_BASE', 'View limit must be a nonnegative integer.');
  }
}
export class ObsidianDocuments implements DocumentCodec {
  inspect(path: string, bytes: Uint8Array): unknown {
    const kind = fileKind(path);
    if (!['markdown', 'canvas', 'base'].includes(kind)) return { kind, encoding: 'base64', content: Buffer.from(bytes).toString('base64') };
    const text = textOf(bytes);
    if (kind === 'markdown') {
      const parts = frontmatter(text), properties: unknown = yamlDocument(parts.yaml).toJS({ maxAliasCount: 100 });
      ensure(properties === null || isRecord(properties), 'INVALID_FRONTMATTER', 'Frontmatter must be a mapping.');
      return { kind, content: text, properties: properties ?? {}, body: parts.body };
    }
    const data: unknown = kind === 'canvas' ? JSON.parse(text.replace(/^\uFEFF/, '')) : yamlDocument(text).toJS({ maxAliasCount: 100 });
    if (kind === 'canvas') validateCanvas(data); else validateBase(data);
    return { kind, data };
  }
  validate(path: string, bytes: Uint8Array): void { this.inspect(path, bytes); }
  properties(bytes: Uint8Array, changes: Record<string, unknown>): Uint8Array {
    const parts = frontmatter(textOf(bytes));
    const doc = yamlDocument(parts.yaml || '{}');
    if (doc.contents === null) doc.contents = doc.createNode({});
    ensure(isMap(doc.contents), 'INVALID_FRONTMATTER', 'Frontmatter must be a mapping.');
    for (const [key, value] of Object.entries(changes)) {
      ensure(!['__proto__', 'constructor', 'prototype'].includes(key), 'INVALID_KEY', key);
      doc.set(key, value);
    }
    const yaml = doc.toString().replace(/\r?\n/g, parts.newline);
    return encode(`${parts.prefix}---${parts.newline}${yaml}---${parts.newline}${parts.body}`);
  }
  patch(path: string, bytes: Uint8Array, pointer: string, value: unknown): Uint8Array {
    const kind = fileKind(path);
    ensure(kind === 'canvas' || kind === 'base', 'UNSUPPORTED_EDIT', 'Pointer edits support Canvas and Bases.');
    const parsed = this.inspect(path, bytes) as { data: Record<string, unknown> };
    ensure(pointer.startsWith('/') && !/~(?![01])/g.test(pointer), 'INVALID_POINTER', 'Use a JSON Pointer such as /views/0/name.');
    const keys = pointer.slice(1).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
    ensure(keys.every(k => !['__proto__', 'constructor', 'prototype'].includes(k)), 'INVALID_POINTER', 'Unsafe pointer segment.');
    let parent: unknown = parsed.data;
    for (const key of keys.slice(0, -1)) {
      ensure(parent !== null && typeof parent === 'object' && Object.hasOwn(parent, key), 'INVALID_POINTER', `Missing parent ${key}.`);
      parent = (parent as Record<string, unknown>)[key];
    }
    ensure(parent !== null && typeof parent === 'object', 'INVALID_POINTER', 'Pointer parent is not a container.');
    const key = keys.at(-1)!;
    if (Array.isArray(parent)) {
      ensure(key === '-' || (/^(0|[1-9]\d*)$/.test(key) && Number(key) < parent.length), 'INVALID_POINTER', 'Use an existing index or - to append.');
      if (key === '-') parent.push(value); else parent[Number(key)] = value;
    } else (parent as Record<string, unknown>)[key] = value;
    // YAML AST edits retain comments and unrelated formatting.
    let result: Uint8Array;
    if (kind === 'base') {
      const doc = yamlDocument(textOf(bytes));
      const pathKeys: (string | number)[] = [];
      let cursor: unknown = (this.inspect(path, bytes) as { data: unknown }).data;
      for (const segment of keys) {
        const part = Array.isArray(cursor) ? (segment === '-' ? cursor.length : Number(segment)) : segment;
        pathKeys.push(part); cursor = cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[String(part)] : undefined;
      }
      doc.setIn(pathKeys, value); result = encode(doc.toString());
    } else result = encode(JSON.stringify(parsed.data, null, 2) + '\n');
    this.validate(path, result); return result;
  }
}
export const encodeText = encode;
export const encodeYaml = (value: unknown) => encode(stringify(value));
