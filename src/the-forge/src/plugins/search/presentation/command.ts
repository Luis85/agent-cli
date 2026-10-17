import type { Command, CommandContext } from '../../../application/plugins/registry.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { arity, integer, value } from '../../../application/plugins/command-input.ts';
import type { JsonSchema } from '../../../domain/schema/json-schema.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import type { SearchFilesResult, SearchResult } from '../application/search.ts';
import { noteFilters } from '../../../domain/metadata/note-filters.ts';
import type { PageRequest } from '../../../domain/shared/paging.ts';
import { maxContextLines, searchKinds, searchScopes, type SearchKind, type SearchQuery, type SearchScope } from '../domain/query.ts';

/** Hits per page when --limit is omitted. */
const defaultSearchLimit = 100;
const text: JsonSchema = { type: 'string' };
const lines: JsonSchema = { type: 'array', items: text };
const count: JsonSchema = { type: 'integer', minimum: 0 };
const total: JsonSchema = { ...count, description: 'Every hit of the query, across all pages.' };
const fileCount: JsonSchema = { ...count, description: 'Every file with hits, across all pages.' };
const output: JsonSchema = { type: 'object', oneOf: [
  {
    title: 'hits', type: 'object', required: ['hits', 'total'],
    properties: {
      hits: { type: 'array', items: {
        type: 'object', required: ['path', 'line', 'column', 'match', 'snippet', 'revision'],
        properties: {
          path: text, line: { type: 'integer', minimum: 1 }, column: { type: 'integer', minimum: 1 }, match: text, snippet: text,
          before: lines, after: lines, revision: text,
        },
      } },
      total, nextCursor: text,
    },
  },
  {
    title: 'files (--files-only)', type: 'object', required: ['files', 'total', 'fileCount'],
    properties: {
      files: { type: 'array', items: { type: 'object', required: ['path', 'revision', 'hits'], properties: { path: text, revision: text, hits: { type: 'integer', minimum: 1 } } } },
      total, fileCount, nextCursor: text,
    },
  },
  { title: 'count (--count)', type: 'object', required: ['total', 'fileCount'], properties: { total, fileCount } },
] };

/** The search modes a command context binds: hits with snippets, or the files with hits. */
export interface SearchService {
  hits(query: SearchQuery, page: PageRequest): Promise<SearchResult>;
  files(query: SearchQuery, page: PageRequest): Promise<SearchFilesResult>;
}

/** `service` binds the search to one command context: its files, metadata cache and configured time budget. */
export function searchCommand(service: (context: CommandContext) => SearchService): Command {
  return {
    id: 'search', description: 'Search text files for a literal or regular-expression pattern and return hits with line, column, snippet and revision.',
    usage: 'search <pattern> [--regex] [--case-sensitive] [--in body|frontmatter|all] [--skip-code] [--kind markdown|canvas|base|text] [--path glob] [--exclude glob] [--tag tag] [--property key[=value]] [--context lines] [--files-only | --count] [--limit count] [--cursor token] [--project id]',
    scope: 'project', projectOption: 'project', discovery: false, mutating: false,
    args: [{ name: 'pattern', description: 'Literal text, or a JavaScript regular expression with --regex. Use -- before a pattern that starts with -.', required: true }],
    options: {
      regex: option.boolean('Treat the pattern as a JavaScript regular expression (u flag).'),
      'case-sensitive': option.boolean('Match case exactly; matching ignores case by default.'),
      in: option.string('Markdown lines to read: the body after frontmatter, the frontmatter, or both.', { enum: searchScopes, default: 'all' }),
      'skip-code': option.boolean('Skip fenced and indented code blocks in Markdown.'),
      kind: option.string('Only files of this text kind.', { enum: searchKinds }),
      path: option.string('Only files whose root-relative path matches this glob, or that are this file or below this folder.'),
      exclude: option.string('Skip files whose root-relative path matches this glob, or that are this file or below this folder; use braces for alternatives.'),
      tag: option.string('Only notes with this tag or a nested tag below it.'),
      property: option.string('Only notes whose frontmatter has key (not null), or key=value.'),
      context: option.string(`Lines of context before and after each hit (0–${maxContextLines}).`, { default: '0' }),
      limit: option.string('Maximum hits, or files with --files-only, per page; a truncated page returns nextCursor.', { default: String(defaultSearchLimit) }),
      cursor: option.string('Continue after the page that returned this nextCursor, with the same pattern and filters.'),
      'files-only': option.boolean('Return the files with hits and their hit counts instead of the hits.'),
      count: option.boolean('Return only the number of hits and of files with hits.'),
      project: option.string('Use this project instead of the selected project.'),
    },
    output,
    errors: ['INVALID_SEARCH_PATTERN', 'SEARCH_TIMEOUT'],
    async run(args, flags, context) {
      arity(args, 1);
      const scope = value(flags, 'in') ?? 'all', kind = value(flags, 'kind');
      const filters = noteFilters(value(flags, 'tag'), value(flags, 'property'));
      const contextLines = integer(flags, 'context') ?? 0;
      ensure(contextLines <= maxContextLines, 'INVALID_ARGUMENT', `--context must be at most ${maxContextLines}.`);
      const files = flags['files-only'] === true, counting = flags.count === true;
      ensure(!(files && counting), 'INVALID_ARGUMENT', 'Choose one of --files-only and --count.');
      ensure(!counting || (flags.limit === undefined && flags.cursor === undefined), 'INVALID_ARGUMENT', '--count returns no page; omit --limit and --cursor.');
      ensure(!(files || counting) || flags.context === undefined, 'INVALID_ARGUMENT', '--context applies only to hits; omit it with --files-only or --count.');
      const query: SearchQuery = {
        pattern: args[0]!, regex: flags.regex === true, caseSensitive: flags['case-sensitive'] === true,
        scope: scope as SearchScope, skipCode: flags['skip-code'] === true, context: contextLines,
        ...(kind === undefined ? {} : { kind: kind as SearchKind }),
        ...(value(flags, 'path') === undefined ? {} : { path: value(flags, 'path') }),
        ...(value(flags, 'exclude') === undefined ? {} : { exclude: value(flags, 'exclude') }),
        ...filters,
      };
      const search = service(context), cursor = value(flags, 'cursor');
      if (counting) {
        const { total, fileCount } = await search.files(query, {});
        return { total, fileCount };
      }
      const page = { limit: integer(flags, 'limit', 1) ?? defaultSearchLimit, ...(cursor === undefined ? {} : { cursor }) };
      return files ? search.files(query, page) : search.hits(query, page);
    },
  };
}
