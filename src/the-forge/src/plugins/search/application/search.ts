import type { MetadataCache } from '../../../application/metadata/ports.ts';
import type { FileRepository } from '../../../application/workspace/ports.ts';
import { fileKind, type FileSnapshot } from '../../../domain/documents/file.ts';
import { pathGlob } from '../../../domain/documents/path-glob.ts';
import { AppError } from '../../../domain/shared/errors.ts';
import { Pager, type PageRequest } from '../../../domain/shared/paging.ts';
import { clipAround, clipLine, matchLines, searchExpression, searchedLines, splitLines } from '../domain/matching.ts';
import { metadataMatches, searchKinds, visiblePath, type SearchKind, type SearchQuery } from '../domain/query.ts';

/** One match: 1-based line and UTF-16 column, the matched text, a clipped snippet and the file's revision. */
export interface SearchHit {
  path: string; line: number; column: number; match: string; snippet: string;
  before?: string[]; after?: string[];
  revision: string;
}
/** `total` counts every hit of the query; `nextCursor` continues a truncated page. */
export interface SearchResult { hits: SearchHit[]; total: number; nextCursor?: string }
/** Runs synchronous matching within one search's time budget; exceeding it throws SEARCH_TIMEOUT. */
export interface SearchBudget { run<T>(task: () => T): T }
export interface SearchSources {
  /** The command scope's repository. */
  files: FileRepository;
  /** The scope's metadata cache, loaded only for tag, property and code filters. */
  metadata(): Promise<MetadataCache>;
  budget: SearchBudget;
}

/** Files read concurrently, then matched together within the budget. */
const batchSize = 32;
const decoder = new TextDecoder('utf-8', { fatal: true });

function decode(bytes: Uint8Array): string | undefined {
  try { return decoder.decode(bytes); }
  catch { return undefined; }
}
async function readExisting(files: FileRepository, path: string): Promise<FileSnapshot | undefined> {
  try { return await files.read(path); }
  catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') return undefined; throw error; }
}
function codeLines(cache: MetadataCache | undefined, path: string): Set<number> {
  const lines = new Set<number>();
  for (const section of cache?.getFileCache(path)?.sections ?? []) {
    if (section.type !== 'code') continue;
    for (let line = section.position.start.line; line <= section.position.end.line; line++) lines.add(line);
  }
  return lines;
}

/**
 * Searches visible text files (Markdown, Canvas, Bases and UTF-8 text) of the scope in path order and returns one
 * page of hits ordered by path, line and column. Attachments, dot-prefixed paths and files that are not valid
 * UTF-8 are skipped. Read-only: it uses repository reads only, which publish no events.
 */
export async function searchFiles(sources: SearchSources, query: SearchQuery, page: PageRequest): Promise<SearchResult> {
  const expression = searchExpression(query);
  const { context: _context, ...ordering } = query;
  const pager = new Pager<SearchHit>(page, { command: 'search', ...ordering }, hit => [hit.path, hit.line, hit.column]);
  const inPath = query.path === undefined ? () => true : pathGlob(query.path);
  const kinds: readonly string[] = query.kind ? [query.kind] : searchKinds;
  const listed = await sources.files.list();
  // Path filtering spends the same budget as matching, so no part of a search runs unbounded.
  const candidates = sources.budget.run(() => listed.filter(path => visiblePath(path) && kinds.includes(fileKind(path)) && inPath(path)));
  const cache = query.tag !== undefined || query.property !== undefined || query.skipCode ? await sources.metadata() : undefined;
  const selected = cache ? candidates.filter(path => metadataMatches(cache.getFileCache(path), query)) : candidates;
  for (let start = 0; start < selected.length; start += batchSize) {
    const batch = await Promise.all(selected.slice(start, start + batchSize).map(path => readExisting(sources.files, path)));
    sources.budget.run(() => {
      for (const file of batch) {
        const text = file && decode(file.bytes);
        if (text === undefined || !file) continue;
        const lines = splitLines(text);
        const included = searchedLines(lines, fileKind(file.path) as SearchKind, query.scope, query.skipCode ? codeLines(cache, file.path) : undefined);
        for (const hit of matchLines(expression, lines, included)) {
          const line = lines[hit.line]!;
          pager.offer({
            path: file.path, line: hit.line + 1, column: hit.column + 1, match: hit.match,
            snippet: clipAround(line, hit.column, hit.column + hit.match.length),
            ...(query.context > 0 ? {
              before: lines.slice(Math.max(0, hit.line - query.context), hit.line).map(clipLine),
              after: lines.slice(hit.line + 1, hit.line + 1 + query.context).map(clipLine),
            } : {}),
            revision: file.revision,
          });
        }
      }
    });
  }
  const nextCursor = pager.nextCursor();
  return { hits: pager.items, total: pager.total, ...(nextCursor === undefined ? {} : { nextCursor }) };
}
