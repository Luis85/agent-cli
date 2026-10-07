import { z } from 'zod';
import { stringify } from 'yaml';
import { AppError, ensure } from '../domain/errors.ts';
import { vaultPath } from '../domain/file.ts';
import type { DataSourceDefinition, DataSourceField, DataSourceValue } from '../domain/data-source.ts';
import type { DataSourceDefinitionCodec } from '../application/data-sources.ts';
import { ObsidianDocuments } from './documents.ts';

const reserved = new Set('arguments await break case catch class const constructor continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected prototype public return static super switch this throw true try typeof var void while with yield undefined __proto__'.split(' '));
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).refine(value => !reserved.has(value), 'Reserved field name');
const value = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
function matches(field: DataSourceField, item: DataSourceValue) {
  return item === null ? field.nullable === true : typeof item === field.type;
}
const field = z.strictObject({
  type: z.enum(['string', 'number', 'boolean']), optional: z.boolean().optional(), nullable: z.boolean().optional(),
  enum: z.array(value).min(1).max(100).optional(), example: value.optional(),
}).superRefine((property, context) => {
  if (property.enum?.some(item => !matches(property, item))) context.addIssue({ code: 'custom', message: 'Enum values must match the field type and nullability.' });
  if (property.enum && new Set(property.enum).size !== property.enum.length) context.addIssue({ code: 'custom', message: 'Enum values must be unique.' });
  if (property.example !== undefined && (!matches(property, property.example) || (property.enum && !property.enum.includes(property.example)))) context.addIssue({ code: 'custom', message: 'Example must match the field type, nullability and enum.' });
});
const operation = z.strictObject({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1).max(2048), responsePath: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/).optional(),
});
const operations = z.strictObject({ list: operation.optional(), get: operation.optional(), create: operation.optional(), update: operation.optional(), delete: operation.optional() });
const schema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().max(120).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/), kind: z.enum(['rest', 'json']),
  model: z.strictObject({ name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/), idField: identifier.default('id'), fields: z.record(identifier, field) }),
  rest: z.strictObject({ baseUrl: z.string().url(), operations }).optional(),
  json: z.strictObject({ path: z.string().min(1) }).optional(),
  testData: z.strictObject({ count: z.number().int().min(1).max(100).optional(), records: z.array(z.record(identifier, value)).min(1).max(100).optional() }).optional(),
}).superRefine((definition, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  const fields = definition.model.fields, primary = fields[definition.model.idField];
  if (!Object.keys(fields).length) issue('Model must define at least one field.');
  if (!primary || !['string', 'number'].includes(primary.type) || primary.optional || primary.nullable) issue('idField must name a required, non-nullable string or number field.');
  const invalidId = (item: unknown) => item === '' || item === '.' || item === '..';
  if (invalidId(primary?.example) || primary?.enum?.some(invalidId)) issue('ID examples and enum values cannot be empty or dot path segments.');
  if (definition.kind === 'rest' ? !definition.rest || !!definition.json : !definition.json || !!definition.rest) issue('Supply only the configuration matching the source kind.');
  if (definition.rest) {
    const url = new URL(definition.rest.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) issue('REST baseUrl must be HTTP(S) without credentials, query or fragment.');
    const entries = Object.entries(definition.rest.operations);
    if (!entries.length) issue('REST must define at least one operation.');
    for (const [name, config] of entries) {
      const methods = name === 'list' || name === 'get' ? ['GET'] : name === 'create' ? ['POST'] : name === 'update' ? ['PUT', 'PATCH'] : ['DELETE'];
      if (!methods.includes(config.method)) issue(`Invalid HTTP method for ${name}.`);
      if (!config.path.startsWith('/') || config.path.startsWith('//') || /[?#\\\s]/.test(config.path) || config.path.split('/').some(part => part === '.' || part === '..')) issue(`Operation ${name} requires an absolute URL pathname without traversal, query or fragment.`);
      try {
        const decoded = decodeURIComponent(config.path);
        if (decoded.split('/').some(part => part === '.' || part === '..') || /[?#\\]/.test(decoded)) issue(`Operation ${name} cannot contain encoded traversal or URL delimiters.`);
      } catch { issue(`Operation ${name} contains malformed URL encoding.`); }
      const placeholders = config.path.match(/\{[^}]*\}/g) ?? [];
      if (placeholders.some(item => item !== '{id}') || /[{}]/.test(config.path.replace(/\{id\}/g, ''))) issue(`Operation ${name} only supports the {id} parameter.`);
      const needsId = ['get', 'update', 'delete'].includes(name);
      if (needsId ? placeholders.length !== 1 : placeholders.length !== 0) issue(`Operation ${name} ${needsId ? 'requires exactly one' : 'cannot use an'} {id} parameter.`);
      if (name === 'delete' && config.responsePath !== undefined) issue('Delete operations do not have a responsePath.');
      if (config.responsePath?.split('.').some(part => reserved.has(part))) issue('responsePath cannot use reserved property names.');
    }
  }
  if (definition.testData?.records && definition.testData.count !== undefined) issue('Use either explicit testData.records or generated testData.count.');
  const ids = new Set<DataSourceValue>();
  for (const [index, record] of (definition.testData?.records ?? []).entries()) {
    for (const key of Object.keys(record)) if (!Object.hasOwn(fields, key)) issue(`Test record ${index} has unknown field ${key}.`);
    for (const [key, property] of Object.entries(fields)) {
      const item = record[key];
      if (item === undefined ? !property.optional : !matches(property, item) || (property.enum && !property.enum.includes(item))) issue(`Test record ${index}.${key} must match its declared field.`);
    }
    const recordId = record[definition.model.idField];
    if (recordId !== undefined) {
      if (invalidId(recordId)) issue('Test record IDs cannot be empty or dot path segments.');
      if (ids.has(recordId)) issue('Test records must have unique IDs.');
      ids.add(recordId);
    }
  }
  const count = definition.testData?.count ?? 3;
  if (!definition.testData?.records && primary?.enum && primary.enum.length < count) issue('ID enum must have enough values for the requested test-data count.');
});

/** Descriptions remain Markdown and are never evaluated as code. */
export class MarkdownDataSourceDefinitions implements DataSourceDefinitionCodec {
  private readonly documents = new ObsidianDocuments();
  parse(bytes: Uint8Array, path: string): DataSourceDefinition {
    vaultPath(path);
    try {
      const document = this.documents.inspect('definition.md', bytes) as { properties: unknown; body: string };
      const result = schema.safeParse(document.properties);
      ensure(result.success, 'INVALID_DATA_SOURCE', `${path}: ${result.success ? '' : result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
      if (result.data.json) {
        vaultPath(result.data.json.path);
        ensure(result.data.json.path.endsWith('.json'), 'INVALID_DATA_SOURCE', `${path}: JSON source path must end in .json.`);
      }
      return { ...result.data, description: document.body, sourcePath: path };
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_DATA_SOURCE') throw error;
      throw new AppError('INVALID_DATA_SOURCE', `${path}: ${error instanceof Error ? error.message : 'Invalid data-source definition.'}`, 2);
    }
  }
  serialize(definition: DataSourceDefinition): Uint8Array {
    const { description, sourcePath, ...frontmatter } = definition;
    const bytes = new TextEncoder().encode(`---\n${stringify(frontmatter)}---\n${description}`);
    this.parse(bytes, sourcePath || `${definition.id}.md`); return bytes;
  }
}
