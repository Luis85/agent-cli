import { ensure } from '../shared/errors.ts';
import { allTags, type CachedMetadata } from './cache.ts';

/** A `--property key` (present and not null) or `--property key=value` filter on top-level frontmatter. */
export interface PropertyFilter { key: string; value?: string }
/** The tag and property filters `list` and `search` share. */
export interface NoteFilters { tag?: string; property?: PropertyFilter }

/** `key` or `key=value`; the key is everything before the first `=`. */
export function propertyFilter(text: string): PropertyFilter | undefined {
  const equals = text.indexOf('=');
  const key = (equals < 0 ? text : text.slice(0, equals)).trim();
  if (!key) return undefined;
  return equals < 0 ? { key } : { key, value: text.slice(equals + 1) };
}

const scalarText = (value: unknown) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;

/**
 * Whether a file's metadata passes the tag and property filters. Tags match case-insensitively with or without
 * `#`, including nested tags (`project` matches `#project/alpha`). A property value matches a scalar's text or
 * any scalar element of a list. Files without metadata pass only when no filter is given.
 */
export function metadataMatches(cache: CachedMetadata | null, query: NoteFilters): boolean {
  if (query.tag !== undefined) {
    const needle = query.tag.replace(/^#/, '').toLowerCase();
    const tags = allTags(cache).map(tag => tag.replace(/^#/, '').toLowerCase());
    if (!tags.some(tag => tag === needle || tag.startsWith(`${needle}/`))) return false;
  }
  if (query.property !== undefined) {
    const frontmatter = cache?.frontmatter;
    if (!frontmatter || !Object.hasOwn(frontmatter, query.property.key)) return false;
    const value = frontmatter[query.property.key];
    if (value === null || value === undefined) return false;
    if (query.property.value !== undefined) {
      const values = Array.isArray(value) ? value : [value];
      if (!values.some(item => scalarText(item) === query.property!.value)) return false;
    }
  }
  return true;
}

/** The filters of `--tag` and `--property` option values; an empty tag or key is INVALID_ARGUMENT. */
export function noteFilters(tag: string | undefined, property: string | undefined): NoteFilters {
  ensure(tag === undefined || tag.replace(/^#/, '').length > 0, 'INVALID_ARGUMENT', '--tag must name a tag.');
  const filter = property === undefined ? undefined : propertyFilter(property);
  ensure(property === undefined || filter, 'INVALID_ARGUMENT', '--property must be key or key=value with a nonempty key.');
  return { ...(tag === undefined ? {} : { tag }), ...(filter === undefined ? {} : { property: filter }) };
}
