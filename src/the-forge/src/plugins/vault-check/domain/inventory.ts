import { acceptsType, inferPropertyType, propertyTypes, type PropertyType } from './property-types.ts';

/** One tag with every file that uses it or a nested tag below it; `count` is the number of those files. */
export interface TagEntry { tag: string; count: number; files: string[] }
export const tagSorts = ['name', 'count'] as const;
export type TagSort = typeof tagSorts[number];

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Tags of the given notes (`#tag` strings per path, frontmatter and inline), rolled up like Obsidian's tag pane:
 * `#a/b` also counts for `#a`. Tags compare without case and keep the spelling seen first in path order.
 * `name` sorts by tag ignoring case; `count` puts the most used tags first, then by name.
 */
export function tagInventory(notes: ReadonlyArray<{ path: string; tags: readonly string[] }>, sort: TagSort): TagEntry[] {
  const entries = new Map<string, { tag: string; files: Set<string> }>();
  for (const { path, tags } of [...notes].sort((a, b) => byText(a.path, b.path))) {
    for (const tag of tags) {
      const parts = tag.replace(/^#/, '').split('/').filter(part => part.length > 0);
      for (let depth = 1; depth <= parts.length; depth++) {
        const spelling = `#${parts.slice(0, depth).join('/')}`, key = spelling.toLowerCase();
        const entry = entries.get(key) ?? { tag: spelling, files: new Set<string>() };
        entries.set(key, entry);
        entry.files.add(path);
      }
    }
  }
  const result = [...entries].sort(([a], [b]) => byText(a, b)).map(([, entry]) => ({ tag: entry.tag, count: entry.files.size, files: [...entry.files] }));
  return sort === 'count' ? result.sort((a, b) => b.count - a.count) : result;
}

/**
 * One property name across notes: how many notes set it, how many values read as each type and how many are empty,
 * the inferred `type` (the most frequent; ties go to the type seen first in path order), the type declared in
 * `.obsidian/types.json` and whether any value conflicts with the declared type or, without one, with `type`.
 */
export interface PropertyEntry {
  name: string; count: number; empty: number;
  types: Partial<Record<PropertyType, number>>;
  type: PropertyType | null; declared: string | null; conflicting: boolean;
  files?: Array<{ path: string; type: PropertyType | null }>;
}

/** Each note's value type for every top-level property, by property name in path order. */
export interface PropertyUse { path: string; type: PropertyType | null }

export function propertyUses(notes: ReadonlyArray<{ path: string; properties: Readonly<Record<string, unknown>> }>): Map<string, PropertyUse[]> {
  const uses = new Map<string, PropertyUse[]>();
  for (const { path, properties } of [...notes].sort((a, b) => byText(a.path, b.path))) {
    for (const [name, value] of Object.entries(properties)) {
      const list = uses.get(name) ?? [];
      uses.set(name, list);
      list.push({ path, type: inferPropertyType(value) });
    }
  }
  return uses;
}

/** The type a property's values should have: the most frequent inferred type, ties to the one seen first. */
export function dominantType(uses: readonly PropertyUse[]): PropertyType | null {
  const counts = new Map<PropertyType, number>();
  for (const { type } of uses) if (type !== null) counts.set(type, (counts.get(type) ?? 0) + 1);
  let best: PropertyType | null = null;
  for (const [type, count] of counts) if (best === null || count > counts.get(best)!) best = type;
  return best;
}

/** Whether one value type conflicts with the declared type or, without a declaration, with the dominant type. */
export function conflicts(type: PropertyType | null, declared: string | null, dominant: PropertyType | null): boolean {
  if (type === null) return false;
  return declared !== null ? !acceptsType(declared, type) : dominant !== null && type !== dominant;
}

/** The property inventory, by name; `withFiles` adds each note's value type. */
export function propertyInventory(uses: ReadonlyMap<string, readonly PropertyUse[]>, declared: Readonly<Record<string, string>>, withFiles: boolean): PropertyEntry[] {
  return [...uses].sort(([a], [b]) => byText(a.toLowerCase(), b.toLowerCase()) || byText(a, b)).map(([name, list]) => {
    const type = dominantType(list), declaration = Object.hasOwn(declared, name) ? declared[name]! : null;
    const types: Partial<Record<PropertyType, number>> = {};
    for (const kind of propertyTypes) {
      const count = list.filter(use => use.type === kind).length;
      if (count > 0) types[kind] = count;
    }
    return {
      name, count: list.length, empty: list.filter(use => use.type === null).length, types, type, declared: declaration,
      conflicting: list.some(use => conflicts(use.type, declaration, type)),
      ...(withFiles ? { files: list.map(({ path, type: kind }) => ({ path, type: kind })) } : {}),
    };
  });
}
