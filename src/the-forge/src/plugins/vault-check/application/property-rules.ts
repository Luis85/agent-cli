import type { MetadataCache } from '../../../application/metadata/ports.ts';
import { conflicts, dominantType, propertyUses } from '../domain/inventory.ts';
import type { TypeRegistry } from '../domain/property-types.ts';
import type { Detection } from '../domain/rules.ts';
import { typesFile, type FrontmatterLocator } from './sources.ts';

/** Frontmatter properties of the parsed notes among `paths`, in path order. */
export function noteProperties(cache: MetadataCache, paths: readonly string[]): Array<{ path: string; properties: Record<string, unknown> }> {
  return paths.flatMap(path => {
    const properties = cache.getFileCache(path)?.frontmatter;
    return properties ? [{ path, properties }] : [];
  });
}

/**
 * `property-type-mismatch`: a value whose type differs from the property's type in `.obsidian/types.json` or,
 * without a declaration, from the type most notes use. Types are inferred over every note in `scope`, as Obsidian
 * assigns one type per property name vault-wide; findings are reported for notes that `report` selects. An invalid
 * types file is one finding on `.obsidian/types.json` and declares nothing.
 */
export async function propertyDetections(
  cache: MetadataCache, scope: readonly string[], report: (path: string) => boolean, registry: TypeRegistry, locator: FrontmatterLocator,
): Promise<Detection[]> {
  const detections: Detection[] = [];
  if (registry.status === 'invalid' && report(typesFile)) {
    detections.push({ rule: 'property-type-mismatch', path: typesFile, line: null, column: null, message: `property-type-mismatch.types-${registry.reason}`, params: {} });
  }
  for (const [name, uses] of propertyUses(noteProperties(cache, scope))) {
    const declared = Object.hasOwn(registry.types, name) ? registry.types[name]! : null;
    const dominant = dominantType(uses);
    const agreeing = uses.filter(use => use.type === dominant).length;
    for (const use of uses) {
      if (!report(use.path) || !conflicts(use.type, declared, dominant)) continue;
      const location = await locator.locate(use.path, cache.getFileCache(use.path)!, name);
      detections.push({
        rule: 'property-type-mismatch', path: use.path, ...location,
        message: declared === null ? 'property-type-mismatch' : 'property-type-mismatch.declared',
        params: { name, actual: use.type!, expected: declared ?? dominant!, count: agreeing },
      });
    }
  }
  return detections;
}
