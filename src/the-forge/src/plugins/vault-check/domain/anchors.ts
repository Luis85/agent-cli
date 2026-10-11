import type { CachedMetadata } from '../../../domain/metadata/cache.ts';

function decoded(text: string): string {
  try { return decodeURIComponent(text); }
  catch { return text; }
}

/**
 * Heading text compared by letters and digits only, ignoring case: `[[Note#My heading]]`, the Markdown link
 * `note.md#My%20heading` and a GitHub-style slug `note.md#my-heading` all name the heading `## My Heading`.
 */
const comparable = (text: string) => decoded(text).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whether a heading named by one subpath segment exists; a trailing `-1` style suffix names a repeated heading. */
function hasHeading(cache: CachedMetadata, segment: string): boolean {
  const headings = new Set((cache.headings ?? []).map(item => comparable(item.heading)));
  const wanted = comparable(segment);
  if (headings.has(wanted)) return true;
  const repeated = / \d+$/.exec(wanted);
  return repeated !== null && headings.has(wanted.slice(0, repeated.index));
}

/**
 * The part of a link subpath (`#Heading`, `#Parent#Child` or `#^block`) that the target note does not contain, or
 * null when every part exists. Block ids compare without case; each heading of a heading path must exist.
 */
export function missingAnchor(subpath: string, cache: CachedMetadata): string | null {
  const segments = subpath.split('#').filter(segment => segment.length > 0);
  const last = segments.at(-1);
  if (last === undefined) return null;
  if (last.startsWith('^')) return Object.hasOwn(cache.blocks ?? {}, decoded(last.slice(1)).toLowerCase()) ? null : `#${last}`;
  const missing = segments.find(segment => !hasHeading(cache, segment));
  return missing === undefined ? null : `#${missing}`;
}
