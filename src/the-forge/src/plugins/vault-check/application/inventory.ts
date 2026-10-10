import { allTags } from '../../../domain/metadata/cache.ts';
import { propertyInventory, propertyUses, tagInventory, type PropertyEntry, type TagEntry, type TagSort } from '../domain/inventory.ts';
import { noteProperties } from './property-rules.ts';
import { readTypeRegistry, typesFile, type VaultSources } from './sources.ts';

/** The vault files an inventory reads: not ignored and inside `--path`. */
export interface InventoryScope { ignored(path: string): boolean; include(path: string): boolean }

async function scoped(sources: VaultSources, scope: InventoryScope) {
  const cache = await sources.cache();
  return { cache, paths: cache.files().filter(path => !scope.ignored(path) && scope.include(path)) };
}

/** `vault tags`: frontmatter and inline tags of the selected notes with nested tags rolled up. */
export async function vaultTags(sources: VaultSources, scope: InventoryScope, sort: TagSort): Promise<{ tags: TagEntry[] }> {
  const { cache, paths } = await scoped(sources, scope);
  return { tags: tagInventory(paths.map(path => ({ path, tags: allTags(cache.getFileCache(path)) })), sort) };
}

/**
 * `vault properties`: the frontmatter property names of the selected notes with their inferred and declared types.
 * `name` keeps one property and adds each note's value type. `typesFile` reports whether `.obsidian/types.json` was
 * `missing`, `loaded` or `invalid` (then nothing is declared).
 */
export async function vaultProperties(sources: VaultSources, scope: InventoryScope, name?: string): Promise<{ properties: PropertyEntry[]; typesFile: { path: string; status: string } }> {
  const { cache, paths } = await scoped(sources, scope);
  const registry = await readTypeRegistry(sources);
  const uses = propertyUses(noteProperties(cache, paths));
  const selected = name === undefined ? uses : new Map([...uses].filter(([property]) => property === name));
  return { properties: propertyInventory(selected, registry.types, name !== undefined), typesFile: { path: typesFile, status: registry.status } };
}
