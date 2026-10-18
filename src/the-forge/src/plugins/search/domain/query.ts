import { PluginFailure } from '../../../domain/shared/plugin-failure.ts';
import type { PropertyFilter } from '../../../domain/metadata/note-filters.ts';

/** Which lines of a file a search reads: Markdown frontmatter, everything after it, or the whole file. */
export type SearchScope = 'body' | 'frontmatter' | 'all';
export const searchScopes: readonly SearchScope[] = ['body', 'frontmatter', 'all'];
/** File kinds a search reads; attachments are never searched. */
export const searchKinds = ['markdown', 'canvas', 'base', 'text'] as const;
export type SearchKind = typeof searchKinds[number];
export const maxPatternLength = 1000;
export const maxContextLines = 50;

export interface SearchQuery {
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  scope: SearchScope;
  skipCode: boolean;
  kind?: SearchKind;
  path?: string;
  /** Root-relative glob excluded before any candidate file is read. */
  exclude?: string;
  tag?: string;
  property?: PropertyFilter;
  /** Lines of context before and after each hit. */
  context: number;
}

/** Plugin-registered failure codes; the host maps them to their catalog entries. */
export type SearchErrorCode = 'INVALID_SEARCH_PATTERN' | 'SEARCH_TIMEOUT';
export function searchError(code: SearchErrorCode, message: string, details?: Record<string, unknown>): PluginFailure {
  return new PluginFailure(code, message, details);
}
