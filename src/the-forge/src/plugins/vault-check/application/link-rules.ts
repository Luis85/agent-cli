import type { MetadataCache, SourceReference } from '../../../application/metadata/ports.ts';
import type { CachedMetadata } from '../../../domain/metadata/cache.ts';
import { missingAnchor } from '../domain/anchors.ts';
import type { Detection, RuleId } from '../domain/rules.ts';
import { closestFile } from '../domain/suggestion.ts';
import type { FrontmatterLocator, Location } from './sources.ts';

/** Body embeds, frontmatter embeds (`"![[…]]"`) and Canvas file nodes show a file; every other reference links to one. */
const embeds = (item: SourceReference) => item.kind === 'embed' || item.kind === 'canvas' || (item.kind === 'frontmatter' && item.reference.embed === true);

async function locate(item: SourceReference, path: string, cache: CachedMetadata, locator: FrontmatterLocator): Promise<Location> {
  if (item.kind === 'link' || item.kind === 'embed') return { line: item.reference.position.start.line + 1, column: item.reference.position.start.col + 1 };
  if (item.kind === 'frontmatter') return locator.locate(path, cache, item.reference.key, item.reference.original);
  return { line: null, column: null };
}

/** Where a reference sits, for messages: the frontmatter property or the Canvas node it belongs to. */
const where = (item: SourceReference) => item.kind === 'frontmatter' ? item.reference.key : item.kind === 'canvas' ? item.reference.node : '';

/**
 * The reference rules of one parsed source: missing targets (`unresolved-link`, `unresolved-embed`, with the closest
 * file name as a suggestion), link paths matching several files (`ambiguous-link`) and `#Heading`/`#^block` subpaths
 * the resolved Markdown target does not contain (`unresolved-anchor`). `runs` tells which rules are enabled.
 */
export async function referenceDetections(
  cache: MetadataCache, path: string, runs: (rule: RuleId) => boolean, locator: FrontmatterLocator, suggest: (linkpath: string) => string | undefined,
): Promise<Detection[]> {
  const source = cache.getFileCache(path);
  if (!source) return [];
  const detections: Detection[] = [];
  for (const item of cache.references(path)) {
    const { resolution, reference } = item;
    const variant = item.kind === 'frontmatter' ? '.frontmatter' : item.kind === 'canvas' ? '.canvas' : '';
    const params = { original: reference.original, link: reference.link, at: where(item) };
    const report = async (rule: RuleId, message: string, extra: Record<string, string> = {}, suggestion?: string) => {
      detections.push({ rule, path, ...await locate(item, path, source, locator), message, params: { ...params, ...extra }, ...(suggestion === undefined ? {} : { suggestion }) });
    };
    if (resolution.status === 'unresolved' && resolution.reason === 'missing') {
      const rule = embeds(item) ? 'unresolved-embed' : 'unresolved-link';
      if (runs(rule)) await report(rule, rule + variant, {}, suggest(resolution.linkpath));
    } else if (resolution.status === 'unresolved') {
      if (runs('ambiguous-link')) await report('ambiguous-link', 'ambiguous-link' + variant, { candidates: resolution.candidates.join(', ') });
    } else if (resolution.status === 'resolved' && reference.subpath && runs('unresolved-anchor')) {
      const target = cache.getFileCache(resolution.path);
      const missing = target && resolution.path.toLowerCase().endsWith('.md') ? missingAnchor(reference.subpath, target) : null;
      if (missing !== null) await report('unresolved-anchor', 'unresolved-anchor' + variant, { anchor: missing, target: resolution.path });
    }
  }
  return detections;
}

/** Closest-file suggestions over the vault's paths, computed once per missing link path. */
export function suggestions(paths: readonly string[]): (linkpath: string) => string | undefined {
  const known = new Map<string, string | undefined>();
  return linkpath => {
    if (!known.has(linkpath)) known.set(linkpath, closestFile(linkpath, paths));
    return known.get(linkpath);
  };
}
