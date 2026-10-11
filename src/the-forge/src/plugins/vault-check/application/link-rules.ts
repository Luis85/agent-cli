import type { MetadataCache, SourceReference } from '../../../application/metadata/ports.ts';
import { missingAnchor } from '../domain/anchors.ts';
import type { Detection, RuleId } from '../domain/rules.ts';
import { ClosestFiles } from '../domain/suggestion.ts';
import type { FrontmatterLocator } from './sources.ts';

/** Body embeds, frontmatter embeds (`"![[…]]"`) and Canvas file nodes show a file; every other reference links to one. */
const embeds = (item: SourceReference) => item.kind === 'embed' || item.kind === 'canvas' || (item.kind === 'frontmatter' && item.reference.embed === true);

/** Where a reference sits, for messages: the frontmatter property or the Canvas node it belongs to. */
const where = (item: SourceReference) => item.kind === 'frontmatter' ? item.reference.key : item.kind === 'canvas' ? item.reference.node : '';

/**
 * The reference rules of one parsed source: missing targets (`unresolved-link`, `unresolved-embed`, with the closest
 * file name as a suggestion), link paths matching several files (`ambiguous-link`) and `#Heading`/`#^block` subpaths
 * the resolved Markdown target does not contain (`unresolved-anchor`). `runs` tells which rules are enabled. Body
 * references carry their position; only frontmatter references wait for the locator, so a source without them
 * returns its detections directly.
 */
export function referenceDetections(
  cache: MetadataCache, path: string, runs: (rule: RuleId) => boolean, locator: FrontmatterLocator, suggest: (linkpath: string) => string | undefined,
): Detection[] | Promise<Detection[]> {
  const source = cache.getFileCache(path);
  if (!source) return [];
  const detections: Detection[] = [], located: Array<Promise<void>> = [];
  for (const item of cache.references(path)) {
    const { resolution, reference } = item;
    const variant = item.kind === 'frontmatter' ? '.frontmatter' : item.kind === 'canvas' ? '.canvas' : '';
    const params = { original: reference.original, link: reference.link, at: where(item) };
    const report = (rule: RuleId, message: string, extra: Record<string, string> = {}, suggestion?: string) => {
      const detection: Detection = { rule, path, line: null, column: null, message, params: { ...params, ...extra }, ...(suggestion === undefined ? {} : { suggestion }) };
      detections.push(detection);
      if (item.kind === 'link' || item.kind === 'embed') Object.assign(detection, { line: item.reference.position.start.line + 1, column: item.reference.position.start.col + 1 });
      else if (item.kind === 'frontmatter') located.push(locator.locate(path, source, item.reference.key, item.reference.original).then(location => { Object.assign(detection, location); }));
    };
    if (resolution.status === 'unresolved' && resolution.reason === 'missing') {
      const rule = embeds(item) ? 'unresolved-embed' : 'unresolved-link';
      if (runs(rule)) report(rule, rule + variant, {}, suggest(resolution.linkpath));
    } else if (resolution.status === 'unresolved') {
      if (runs('ambiguous-link')) report('ambiguous-link', 'ambiguous-link' + variant, { candidates: resolution.candidates.join(', ') });
    } else if (resolution.status === 'resolved' && reference.subpath && runs('unresolved-anchor')) {
      const target = cache.getFileCache(resolution.path);
      const missing = target && resolution.path.toLowerCase().endsWith('.md') ? missingAnchor(reference.subpath, target) : null;
      if (missing !== null) report('unresolved-anchor', 'unresolved-anchor' + variant, { anchor: missing, target: resolution.path });
    }
  }
  return located.length === 0 ? detections : Promise.all(located).then(() => detections);
}

/** Closest-file suggestions over the vault's paths, computed once per missing link path. */
export function suggestions(paths: readonly string[]): (linkpath: string) => string | undefined {
  const known = new Map<string, string | undefined>();
  let index: ClosestFiles | undefined;
  return linkpath => {
    if (!known.has(linkpath)) known.set(linkpath, (index ??= new ClosestFiles(paths)).closest(linkpath));
    return known.get(linkpath);
  };
}
