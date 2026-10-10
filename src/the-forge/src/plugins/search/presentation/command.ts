import type { Command, CommandContext } from '../../../application/plugins/registry.ts';
import { option } from '../../../application/plugins/command-metadata.ts';
import { arity, integer, value } from '../../../application/plugins/command-input.ts';
import type { JsonSchema } from '../../../domain/schema/json-schema.ts';
import { ensure } from '../../../domain/shared/errors.ts';
import type { SearchResult } from '../application/search.ts';
import type { PageRequest } from '../../../domain/shared/paging.ts';
import { maxContextLines, propertyFilter, searchKinds, searchScopes, type SearchKind, type SearchQuery, type SearchScope } from '../domain/query.ts';

/** Hits per page when --limit is omitted. */
const defaultSearchLimit = 100;
const text: JsonSchema = { type: 'string' };
const lines: JsonSchema = { type: 'array', items: text };
const output: JsonSchema = {
  type: 'object', required: ['hits', 'total'],
  properties: {
    hits: { type: 'array', items: {
      type: 'object', required: ['path', 'line', 'column', 'match', 'snippet', 'revision'],
      properties: {
        path: text, line: { type: 'integer', minimum: 1 }, column: { type: 'integer', minimum: 1 }, match: text, snippet: text,
        before: lines, after: lines, revision: text,
      },
    } },
    total: { type: 'integer', minimum: 0 },
    nextCursor: text,
  },
};

/** `service` binds the search to one command context: its files, metadata cache and configured time budget. */
export function searchCommand(service: (context: CommandContext) => (query: SearchQuery, page: PageRequest) => Promise<SearchResult>): Command {
  return {
    id: 'search', description: 'Search text files for a literal or regular-expression pattern and return hits with line, column, snippet and revision.',
    usage: 'search <pattern> [--regex] [--case-sensitive] [--in body|frontmatter|all] [--skip-code] [--kind markdown|canvas|base|text] [--path glob] [--tag tag] [--property key[=value]] [--context lines] [--limit count] [--cursor token]',
    scope: 'project', discovery: false, mutating: false,
    args: [{ name: 'pattern', description: 'Literal text, or a JavaScript regular expression with --regex. Use -- before a pattern that starts with -.', required: true }],
    options: {
      regex: option.boolean('Treat the pattern as a JavaScript regular expression (u flag).'),
      'case-sensitive': option.boolean('Match case exactly; matching ignores case by default.'),
      in: option.string('Markdown lines to read: the body after frontmatter, the frontmatter, or both.', { enum: searchScopes, default: 'all' }),
      'skip-code': option.boolean('Skip fenced and indented code blocks in Markdown.'),
      kind: option.string('Only files of this text kind.', { enum: searchKinds }),
      path: option.string('Only files whose root-relative path matches this glob.'),
      tag: option.string('Only notes with this tag or a nested tag below it.'),
      property: option.string('Only notes whose frontmatter has key (not null), or key=value.'),
      context: option.string(`Lines of context before and after each hit (0–${maxContextLines}).`, { default: '0' }),
      limit: option.string('Maximum hits per page; a truncated page returns nextCursor.', { default: String(defaultSearchLimit) }),
      cursor: option.string('Continue after the page that returned this nextCursor, with the same pattern and filters.'),
    },
    output,
    errors: ['INVALID_SEARCH_PATTERN', 'SEARCH_TIMEOUT'],
    async run(args, flags, context) {
      arity(args, 1);
      const scope = value(flags, 'in') ?? 'all', kind = value(flags, 'kind'), property = value(flags, 'property');
      ensure(searchScopes.includes(scope as SearchScope), 'INVALID_ARGUMENT', `--in must be one of: ${searchScopes.join(', ')}.`);
      ensure(kind === undefined || (searchKinds as readonly string[]).includes(kind), 'INVALID_ARGUMENT', `--kind must be one of: ${searchKinds.join(', ')}; search never reads attachments.`);
      const filter = property === undefined ? undefined : propertyFilter(property);
      ensure(property === undefined || filter, 'INVALID_ARGUMENT', '--property must be key or key=value with a nonempty key.');
      const contextLines = integer(flags, 'context') ?? 0;
      ensure(contextLines <= maxContextLines, 'INVALID_ARGUMENT', `--context must be at most ${maxContextLines}.`);
      const tag = value(flags, 'tag');
      ensure(tag === undefined || tag.replace(/^#/, '').length > 0, 'INVALID_ARGUMENT', '--tag must name a tag.');
      const query: SearchQuery = {
        pattern: args[0]!, regex: flags.regex === true, caseSensitive: flags['case-sensitive'] === true,
        scope: scope as SearchScope, skipCode: flags['skip-code'] === true, context: contextLines,
        ...(kind === undefined ? {} : { kind: kind as SearchKind }),
        ...(value(flags, 'path') === undefined ? {} : { path: value(flags, 'path') }),
        ...(tag === undefined ? {} : { tag }),
        ...(filter === undefined ? {} : { property: filter }),
      };
      const cursor = value(flags, 'cursor');
      return service(context)(query, { limit: integer(flags, 'limit', 1) ?? defaultSearchLimit, ...(cursor === undefined ? {} : { cursor }) });
    },
  };
}
