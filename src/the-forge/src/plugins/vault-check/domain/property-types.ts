import { isRecord } from '../../../domain/shared/errors.ts';

/**
 * Property value types as Obsidian names them in the Properties view: Text, List, Number, Checkbox, Date and
 * Date & time, plus `object` for a nested mapping, which the Properties view does not support.
 */
export const propertyTypes = ['text', 'list', 'number', 'checkbox', 'date', 'datetime', 'object'] as const;
export type PropertyType = typeof propertyTypes[number];

/** Type names Obsidian records in `.obsidian/types.json`, with the inferred types each accepts. */
const declaredAccepts: Readonly<Record<string, readonly PropertyType[]>> = {
  text: ['text', 'date', 'datetime'],
  multitext: ['list'],
  tags: ['list', 'text'],
  aliases: ['list', 'text'],
  number: ['number'],
  checkbox: ['checkbox'],
  date: ['date'],
  datetime: ['datetime', 'date'],
};

const date = /^\d{4}-\d{2}-\d{2}$/;
const datetime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * The type a frontmatter value reads as; null for an empty value (`key:` or `key: ""`), which fits every type.
 * Dates are ISO strings because the codec keeps YAML timestamps as text.
 */
export function inferPropertyType(value: unknown): PropertyType | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'list';
  if (isRecord(value)) return 'object';
  const text = String(value);
  return date.test(text) ? 'date' : datetime.test(text) ? 'datetime' : 'text';
}

/** Whether a value of `actual` type fits a declared Obsidian type; unknown declared names accept everything. */
export function acceptsType(declared: string, actual: PropertyType): boolean {
  const accepted = declaredAccepts[declared];
  return accepted === undefined || accepted.includes(actual);
}

/** The parsed property type registry: declared names by property, or the reason the file was ignored. */
export type TypeRegistry =
  | { status: 'missing'; types: Record<string, string> }
  | { status: 'loaded'; types: Record<string, string> }
  | { status: 'invalid'; types: Record<string, string>; reason: 'json' | 'shape' };

/**
 * Reads `.obsidian/types.json` (`{"types": {"<property>": "<type>"}}`). Invalid JSON or a missing `types` mapping
 * makes the registry `invalid` (`reason` `json` or `shape`) with no declared types; entries whose type is not a string are skipped.
 */
export function typeRegistry(text: string | null): TypeRegistry {
  if (text === null) return { status: 'missing', types: {} };
  let data: unknown;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { return { status: 'invalid', types: {}, reason: 'json' }; }
  if (!isRecord(data) || !isRecord(data.types)) return { status: 'invalid', types: {}, reason: 'shape' };
  const types: Record<string, string> = {};
  for (const [name, type] of Object.entries(data.types)) if (typeof type === 'string') types[name] = type;
  return { status: 'loaded', types };
}
