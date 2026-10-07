import { parseDocument, stringify, isMap, isScalar, isAlias, visit, type Document } from 'yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { AppError, ensure, isRecord } from '../domain/errors.ts';
import { fileKind } from '../domain/file.ts';
import { validateCanvas } from '../domain/canvas.ts';
import type { DocumentCodec } from '../application/ports.ts';

const encode = (text: string) => new TextEncoder().encode(text);
function textOf(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new AppError('INVALID_ENCODING', 'Structured documents must be valid UTF-8.', 2); }
}
function yamlDocument(text: string): Document {
  const document = parseDocument(text, { uniqueKeys: true });
  ensure(!document.errors.length, 'INVALID_YAML', document.errors.map(e => e.message).join('; '));
  visit(document, (key, node, path) => {
    ensure(path.length < 200, 'INVALID_YAML', 'YAML nesting is too deep.');
    if (key === 'key') ensure(isScalar(node) && typeof node.value === 'string', 'INVALID_YAML', 'YAML mapping keys must be strings.');
  });
  return document;
}
function jsonValue(value: unknown, code: string, ancestors = new Set<object>(), depth = 0): void {
  ensure(depth < 100, code, 'Document nesting is too deep.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { ensure(Number.isFinite(value), code, 'Document numbers must be finite.'); return; }
  ensure(typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), code, 'Document values must be JSON-compatible.');
  ensure(!ancestors.has(value), code, 'Cyclic YAML aliases are not supported.');
  ancestors.add(value);
  for (const child of Object.values(value)) jsonValue(child, code, ancestors, depth + 1);
  ancestors.delete(value);
}
function yamlValue(document: Document): unknown {
  let value: unknown;
  try { value = document.toJS({ maxAliasCount: 100 }); }
  catch (error) { throw new AppError('INVALID_YAML', error instanceof Error ? error.message : 'Invalid YAML aliases.', 2); }
  jsonValue(value, 'INVALID_YAML');
  return value;
}
function textStyle(text: string) {
  return { prefix: text.startsWith('\uFEFF') ? '\uFEFF' : '', newline: text.match(/\r\n|\n|\r/)?.[0] ?? '\n' };
}
function styledText(text: string, original: string): Uint8Array {
  const { prefix, newline } = textStyle(original);
  return encode(prefix + text.replace(/^\uFEFF/, '').replace(/\r?\n/g, newline));
}
const markdownParser = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']);
export function parseMarkdownParts(text: string) {
  const prefix = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  text = text.slice(prefix.length);
  const firstNode = markdownParser.parse(text).children[0];
  const firstNewline = /\r\n|\n|\r/.exec(text);
  const opensFrontmatter = firstNewline !== null && text.slice(0, firstNewline.index).trimEnd() === '---';
  const newline = textStyle(text).newline;
  if (firstNode?.type !== 'yaml') {
    ensure(!opensFrontmatter, 'INVALID_FRONTMATTER', 'Unclosed YAML frontmatter.');
    return { yaml: '', body: text, newline, exists: false, prefix };
  }
  const end = firstNode.position?.end.offset;
  ensure(end !== undefined && firstNewline !== null, 'INVALID_FRONTMATTER', 'Missing frontmatter source position.');
  // Slice the original source using parser offsets; serializing Markdown would
  // rewrite wikilinks, line endings, whitespace and other Obsidian body syntax.
  const closingLineStart = Math.max(text.lastIndexOf('\n', end - 1), text.lastIndexOf('\r', end - 1)) + 1;
  const separatorLength = text.startsWith('\r\n', end) ? 2 : text.startsWith('\n', end) || text.startsWith('\r', end) ? 1 : 0;
  return { yaml: text.slice(firstNewline.index + firstNewline[0].length, closingLineStart), body: text.slice(end + separatorLength), newline, exists: true, prefix };
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
      const parts = parseMarkdownParts(text), properties = yamlValue(yamlDocument(parts.yaml));
      ensure(properties === null || isRecord(properties), 'INVALID_FRONTMATTER', 'Frontmatter must be a mapping.');
      return { kind, content: text, properties: properties ?? {}, body: parts.body };
    }
    let data: unknown;
    if (kind === 'canvas') {
      try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
      catch { throw new AppError('INVALID_CANVAS', 'Canvas must contain valid JSON.', 2); }
      jsonValue(data, 'INVALID_CANVAS');
    } else data = yamlValue(yamlDocument(text));
    if (kind === 'canvas') validateCanvas(data); else validateBase(data);
    return { kind, data };
  }
  validate(path: string, bytes: Uint8Array): void { this.inspect(path, bytes); }
  properties(bytes: Uint8Array, changes: Record<string, unknown>): Uint8Array {
    const parts = parseMarkdownParts(textOf(bytes));
    const doc = yamlDocument(parts.yaml || '{}');
    yamlValue(doc);
    jsonValue(changes, 'INVALID_FRONTMATTER');
    if (doc.contents === null) doc.contents = doc.createNode({});
    ensure(isMap(doc.contents), 'INVALID_FRONTMATTER', 'Frontmatter must be a mapping.');
    for (const [key, value] of Object.entries(changes)) {
      ensure(!['__proto__', 'constructor', 'prototype'].includes(key), 'INVALID_KEY', key);
      doc.set(key, value);
    }
    const yaml = doc.toString().replace(/\r?\n/g, parts.newline);
    const result = encode(`${parts.prefix}---${parts.newline}${yaml}---${parts.newline}${parts.body}`);
    this.validate('note.md', result);
    return result;
  }
  patch(path: string, bytes: Uint8Array, pointer: string, value: unknown): Uint8Array {
    const kind = fileKind(path);
    ensure(kind === 'canvas' || kind === 'base', 'UNSUPPORTED_EDIT', 'Pointer edits support Canvas and Bases.');
    const parsed = this.inspect(path, bytes) as { data: Record<string, unknown> };
    jsonValue(value, kind === 'canvas' ? 'INVALID_CANVAS' : 'INVALID_BASE');
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
        ensure(!isAlias(doc.getIn(pathKeys, true)), 'INVALID_POINTER', 'Cannot edit through a YAML alias; replace the alias value or edit its anchor.');
        const part = Array.isArray(cursor) ? (segment === '-' ? cursor.length : Number(segment)) : segment;
        pathKeys.push(part); cursor = cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[String(part)] : undefined;
      }
      doc.setIn(pathKeys, value); result = styledText(doc.toString(), textOf(bytes));
    } else result = styledText(JSON.stringify(parsed.data, null, 2) + '\n', textOf(bytes));
    this.validate(path, result); return result;
  }
}
export const encodeText = encode;
export const encodeYaml = (value: unknown) => encode(stringify(value));
