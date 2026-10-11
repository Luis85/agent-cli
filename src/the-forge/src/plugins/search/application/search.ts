import type { CachedMetadata } from '../../../domain/metadata/cache.ts';
import type { FileRepository } from '../../../application/workspace/ports.ts';
import { fileKind, type FileSnapshot } from '../../../domain/documents/file.ts';
import { pathGlob } from '../../../domain/documents/path-glob.ts';
import { AppError } from '../../../domain/shared/errors.ts';
import { Pager, type PageRequest } from '../../../domain/shared/paging.ts';
import { clipAround, clipLine, matchLines, searchExpression, searchedLines, splitLines } from '../domain/matching.ts';
import { metadataMatches, searchKinds, type SearchKind, type SearchQuery } from '../domain/query.ts';

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
  /** The scope's vault paths, as the metadata index enumerates them (`MetadataIndex.vaultFiles`). */
  paths(): Promise<readonly string[]>;
  /** The metadata of one read file (`MetadataIndex.parseFile`), used only by tag, property and code filters. */
  parse(path: string, bytes: Uint8Array): CachedMetadata | null;
  budget: SearchBudget;
}
/** A hit before its snippet and context lines are built, which happens only for hits on the returned page. */
interface PendingHit { path: string; line: number; column: number; match: string; revision: string; lines: readonly string[] }

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
function codeLines(metadata: CachedMetadata | null): Set<number> {
  const lines = new Set<number>();
  for (const section of metadata?.sections ?? []) {
    if (section.type !== 'code') continue;
    for (let line = section.position.start.line; line <= section.position.end.line; line++) lines.add(line);
  }
  return lines;
}

/** The snippet and context lines of a hit on the returned page. */
function completed({ lines, revision, ...hit }: PendingHit, context: number): SearchHit {
  const index = hit.line - 1, start = hit.column - 1, line = lines[index]!;
  return {
    ...hit, snippet: clipAround(line, start, start + hit.match.length),
    ...(context > 0 ? {
      before: lines.slice(Math.max(0, index - context), index).map(clipLine),
      after: lines.slice(index + 1, index + 1 + context).map(clipLine),
    } : {}),
    revision,
  };
}

/**
 * Searches the scope's vault text files (Markdown, Canvas, Bases and UTF-8 text) in path order and returns one page
 * of hits ordered by path, line and column. Attachments, paths outside the vault rule and files that are not valid
 * UTF-8 are skipped. Each candidate file is read once and matched first; tag, property and code filters then parse
 * only files with hits, never the whole vault, and snippets are built only for the returned page. Read-only: it
 * uses repository reads only, which publish no events.
 */
export async function searchFiles(sources: SearchSources, query: SearchQuery, page: PageRequest): Promise<SearchResult> {
  const expression = searchExpression(query);
  const { context: _context, ...ordering } = query;
  const pager = new Pager<PendingHit>(page, { command: 'search', ...ordering }, hit => [hit.path, hit.line, hit.column]);
  const inPath = query.path === undefined ? () => true : pathGlob(query.path);
  const kinds: readonly string[] = query.kind ? [query.kind] : searchKinds;
  const listed = await sources.paths();
  // Path filtering spends the same budget as matching, so no part of a search runs unbounded.
  const candidates = sources.budget.run(() => listed.filter(path => kinds.includes(fileKind(path)) && inPath(path)));
  const filtered = query.tag !== undefined || query.property !== undefined;
  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = await Promise.all(candidates.slice(start, start + batchSize).map(path => readExisting(sources.files, path)));
    const scanned = sources.budget.run(() => batch.flatMap(file => {
      const text = file && decode(file.bytes);
      if (!file || text === undefined) return [];
      const lines = splitLines(text);
      const hits = matchLines(expression, lines, searchedLines(lines, fileKind(file.path) as SearchKind, query.scope));
      return hits.length > 0 ? [{ file, lines, hits }] : [];
    }));
    for (const { file, lines, hits } of scanned) {
      // Metadata parsing happens outside the matching budget and only for files with hits.
      const metadata = filtered || query.skipCode ? sources.parse(file.path, file.bytes) : null;
      if (filtered && !metadataMatches(metadata, query)) continue;
      const code = query.skipCode ? codeLines(metadata) : undefined;
      for (const hit of hits) {
        if (code?.has(hit.line)) continue;
        pager.offer({ path: file.path, line: hit.line + 1, column: hit.column + 1, match: hit.match, revision: file.revision, lines });
      }
    }
  }
  const nextCursor = pager.nextCursor();
  return { hits: pager.items.map(hit => completed(hit, query.context)), total: pager.total, ...(nextCursor === undefined ? {} : { nextCursor }) };
}
