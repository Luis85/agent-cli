import { allTags, type CachedMetadata } from '../../../domain/metadata/cache.ts';

/** Which lines of a file a search reads: Markdown frontmatter, everything after it, or the whole file. */
export type SearchScope = 'body' | 'frontmatter' | 'all';
export const searchScopes: readonly SearchScope[] = ['body', 'frontmatter', 'all'];
/** File kinds a search reads; attachments are never searched. */
export const searchKinds = ['markdown', 'canvas', 'base', 'text'] as const;
export type SearchKind = typeof searchKinds[number];
export const maxPatternLength = 1000;
export const maxContextLines = 50;

/** A `--property key` (present and not null) or `--property key=value` filter on top-level frontmatter. */
export interface PropertyFilter { key: string; value?: string }
export interface SearchQuery {
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  scope: SearchScope;
  skipCode: boolean;
  kind?: SearchKind;
  path?: string;
  tag?: string;
  property?: PropertyFilter;
  /** Lines of context before and after each hit. */
  context: number;
}

/** Plugin-registered failure codes; the host maps them to their catalog entries. */
export type SearchErrorCode = 'INVALID_SEARCH_PATTERN' | 'SEARCH_TIMEOUT';
export function searchError(code: SearchErrorCode, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

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
export function metadataMatches(cache: CachedMetadata | null, query: Pick<SearchQuery, 'tag' | 'property'>): boolean {
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

/** Whether a root-relative path is visible: no segment starts with a dot. */
export const visiblePath = (path: string) => !path.split('/').some(segment => segment.startsWith('.'));
