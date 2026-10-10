/**
 * The JSON Schema 2020-12 subset Forge emits for command input and accepts for plugin settings. It covers what
 * command options, positional arguments and configuration sections need; unsupported keywords are rejected rather
 * than ignored, so a schema never promises validation it does not get.
 */
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
export interface JsonSchema {
  $schema?: string; title?: string; description?: string;
  type?: JsonSchemaType;
  properties?: Record<string, JsonSchema>; required?: string[]; additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema; prefixItems?: JsonSchema[]; minItems?: number; maxItems?: number;
  enum?: unknown[]; const?: unknown; default?: unknown;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string;
}

export const jsonSchemaDialect = 'https://json-schema.org/draft/2020-12/schema';
const types: readonly JsonSchemaType[] = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const keywords: Record<string, (value: unknown, path: string) => string[]> = {
  $schema: (value, path) => value === jsonSchemaDialect ? [] : [`${path}.$schema must be ${jsonSchemaDialect}`],
  title: (value, path) => typeof value === 'string' ? [] : [`${path}.title must be a string`],
  description: (value, path) => typeof value === 'string' ? [] : [`${path}.description must be a string`],
  type: (value, path) => types.includes(value as JsonSchemaType) ? [] : [`${path}.type must be one of ${types.join(', ')}`],
  properties: (value, path) => record(value) ? Object.entries(value).flatMap(([key, schema]) => schemaIssues(schema, `${path}.properties.${key}`)) : [`${path}.properties must be an object`],
  required: (value, path) => Array.isArray(value) && value.every(item => typeof item === 'string') && new Set(value).size === value.length ? [] : [`${path}.required must list unique property names`],
  additionalProperties: (value, path) => typeof value === 'boolean' ? [] : schemaIssues(value, `${path}.additionalProperties`),
  items: (value, path) => schemaIssues(value, `${path}.items`),
  prefixItems: (value, path) => Array.isArray(value) ? value.flatMap((schema, index) => schemaIssues(schema, `${path}.prefixItems[${index}]`)) : [`${path}.prefixItems must be an array`],
  minItems: (value, path) => count(value) ? [] : [`${path}.minItems must be a nonnegative integer`],
  maxItems: (value, path) => count(value) ? [] : [`${path}.maxItems must be a nonnegative integer`],
  minLength: (value, path) => count(value) ? [] : [`${path}.minLength must be a nonnegative integer`],
  maxLength: (value, path) => count(value) ? [] : [`${path}.maxLength must be a nonnegative integer`],
  minimum: (value, path) => Number.isFinite(value) ? [] : [`${path}.minimum must be a number`],
  maximum: (value, path) => Number.isFinite(value) ? [] : [`${path}.maximum must be a number`],
  enum: (value, path) => Array.isArray(value) && value.length > 0 ? [] : [`${path}.enum must be a nonempty array`],
  const: () => [],
  default: () => [],
  pattern: (value, path) => {
    if (typeof value !== 'string') return [`${path}.pattern must be a string`];
    try { new RegExp(value, 'u'); return []; } catch { return [`${path}.pattern must be a valid regular expression`]; }
  },
};

/** Structural meta-check of the supported subset: each problem names the schema path. */
export function schemaIssues(schema: unknown, path = 'schema'): string[] {
  if (!record(schema)) return [`${path} must be a schema object`];
  return Object.entries(schema).flatMap(([key, value]) => Object.hasOwn(keywords, key) ? keywords[key]!(value, path) : [`${path} uses unsupported keyword ${key}`]);
}

function typeMatches(type: JsonSchemaType, value: unknown): boolean {
  if (type === 'object') return record(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const copy = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;

/**
 * Validates `value` against a schema that passed `schemaIssues`, filling `default`s of missing object properties.
 * Returns the completed copy and every issue as `<path>: <problem>`.
 */
export function validateJsonValue(schema: JsonSchema, value: unknown, path: string): { value: unknown; issues: string[] } {
  const issues: string[] = [];
  const visit = (node: JsonSchema, current: unknown, at: string): unknown => {
    if (node.type !== undefined && !typeMatches(node.type, current)) { issues.push(`${at}: must be ${node.type}`); return current; }
    if (node.enum !== undefined && !node.enum.some(item => same(item, current))) issues.push(`${at}: must be one of ${node.enum.map(item => JSON.stringify(item)).join(', ')}`);
    if (Object.hasOwn(node, 'const') && !same(node.const, current)) issues.push(`${at}: must equal ${JSON.stringify(node.const)}`);
    if (typeof current === 'string') {
      if (node.minLength !== undefined && current.length < node.minLength) issues.push(`${at}: must have at least ${node.minLength} characters`);
      if (node.maxLength !== undefined && current.length > node.maxLength) issues.push(`${at}: must have at most ${node.maxLength} characters`);
      if (node.pattern !== undefined && !new RegExp(node.pattern, 'u').test(current)) issues.push(`${at}: must match ${node.pattern}`);
    }
    if (typeof current === 'number') {
      if (node.minimum !== undefined && current < node.minimum) issues.push(`${at}: must be at least ${node.minimum}`);
      if (node.maximum !== undefined && current > node.maximum) issues.push(`${at}: must be at most ${node.maximum}`);
    }
    if (Array.isArray(current)) {
      if (node.minItems !== undefined && current.length < node.minItems) issues.push(`${at}: must have at least ${node.minItems} items`);
      if (node.maxItems !== undefined && current.length > node.maxItems) issues.push(`${at}: must have at most ${node.maxItems} items`);
      return current.map((item, index) => {
        const itemSchema = node.prefixItems?.[index] ?? node.items;
        return itemSchema ? visit(itemSchema, item, `${at}[${index}]`) : item;
      });
    }
    if (!record(current)) return current;
    const result: Record<string, unknown> = {};
    for (const key of node.required ?? []) if (!Object.hasOwn(current, key) && node.properties?.[key]?.default === undefined) issues.push(`${at}.${key}: is required`);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      if (Object.hasOwn(current, key)) result[key] = visit(child, current[key], `${at}.${key}`);
      else if (child.default !== undefined) result[key] = copy(child.default);
    }
    for (const [key, item] of Object.entries(current)) {
      if (node.properties && Object.hasOwn(node.properties, key)) continue;
      if (node.additionalProperties === false) issues.push(`${at}.${key}: is not allowed`);
      else result[key] = typeof node.additionalProperties === 'object' ? visit(node.additionalProperties, item, `${at}.${key}`) : item;
    }
    return result;
  };
  const completed = visit(schema, value === undefined && schema.default !== undefined ? copy(schema.default) : value, path);
  return { value: completed, issues };
}
