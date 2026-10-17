import type { CachedMetadata } from '../../../domain/metadata/cache.ts';
import type { FileRepository } from '../../../application/workspace/ports.ts';
import { fileKind, isTextContent, type FileSnapshot } from '../../../domain/documents/file.ts';
import { pathFilter, recordingFilter } from '../../../domain/documents/path-glob.ts';
import { kernelMessage, type KernelMessage } from '../../../domain/shared/kernel-messages.ts';
import { metadataMatches } from '../../../domain/metadata/note-filters.ts';
import { AppError } from '../../../domain/shared/errors.ts';
import { Pager, type PageRequest } from '../../../domain/shared/paging.ts';
import { clipAround, clipLine, matchLines, searchExpression, searchedLines, splitLines, type LineHit } from '../domain/matching.ts';
import { searchKinds, type SearchKind, type SearchQuery } from '../domain/query.ts';

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
  /**
   * The metadata of one read file (`MetadataIndex.parseFile`), used only by tag, property and code filters; a stored
   * parse result of the same content is reused.
   */
  parse(file: { path: string; bytes: Uint8Array }): Promise<CachedMetadata | null>;
  budget: SearchBudget;
  /** The command's warning sink, for a `--path` that matches nothing. */
  warn(message: KernelMessage): void;
}
/** A hit before its snippet and context lines are built, which happens only for hits on the returned page. */
interface PendingHit { path: string; line: number; column: number; match: string; revision: string; lines: readonly string[] }

/** Files read concurrently, then matched together within the budget. */
const batchSize = 32;
const decoder = new TextDecoder('utf-8', { fatal: true });

/** The searchable text of a file: undefined for invalid UTF-8 and for text files with NUL characters, which read as attachments. */
function decode({ path, bytes }: FileSnapshot): string | undefined {
  let text: string;
  try { text = decoder.decode(bytes); }
  catch { return undefined; }
  return isTextContent(path, text) ? text : undefined;
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

/** One file with hits for `search --files-only`: its revision and how many hits it has. */
export interface SearchFile { path: string; revision: string; hits: number }
/** `total` counts every hit and `fileCount` every file with hits; `nextCursor` continues a truncated page of files. */
export interface SearchFilesResult { files: SearchFile[]; total: number; fileCount: number; nextCursor?: string }
type Visit = (file: FileSnapshot, lines: readonly string[], hits: readonly LineHit[]) => void;

/**
 * Visits the scope's vault text files with hits (Markdown, Canvas, Bases and UTF-8 text) in path order, with their hits
 * in line and column order. Attachments, paths outside the vault rule, files that are not valid UTF-8 and text files
 * containing NUL characters (which read as attachments) are skipped. Each candidate file is read once and matched
 * first; tag, property and code filters then parse only files with hits, never the whole vault. A `--path` that
 * matches no vault path warns PATH_MATCHED_NOTHING. Read-only: it uses repository reads only, which publish no events.
 */
async function scanFiles(sources: SearchSources, query: SearchQuery, visit: Visit): Promise<void> {
  const expression = searchExpression(query);
  const inPath = recordingFilter(query.path === undefined ? () => true : pathFilter(query.path));
  const excluded = query.exclude === undefined ? () => false : pathFilter(query.exclude, '--exclude');
  const kinds: readonly string[] = query.kind ? [query.kind] : searchKinds;
  const listed = await sources.paths();
  // Path filtering spends the same budget as matching, so no part of a search runs unbounded.
  const candidates = sources.budget.run(() => listed.filter(path => inPath.matches(path) && kinds.includes(fileKind(path)) && !excluded(path)));
  if (query.path !== undefined && !inPath.matched()) sources.warn(kernelMessage('PATH_MATCHED_NOTHING', { option: '--path', pattern: query.path }));
  const filtered = query.tag !== undefined || query.property !== undefined;
  for (let start = 0; start < candidates.length; start += batchSize) {
    const batch = await Promise.all(candidates.slice(start, start + batchSize).map(path => readExisting(sources.files, path)));
    const scanned = sources.budget.run(() => batch.flatMap(file => {
      const text = file && decode(file);
      if (!file || text === undefined) return [];
      const lines = splitLines(text);
      const hits = matchLines(expression, lines, searchedLines(lines, fileKind(file.path) as SearchKind, query.scope));
      return hits.length > 0 ? [{ file, lines, hits }] : [];
    }));
    for (const { file, lines, hits } of scanned) {
      // Metadata parsing happens outside the matching budget and only for files with hits.
      const metadata = filtered || query.skipCode ? await sources.parse(file) : null;
      if (filtered && !metadataMatches(metadata, query)) continue;
      const code = query.skipCode ? codeLines(metadata) : undefined;
      const kept = code === undefined ? hits : hits.filter(hit => !code.has(hit.line));
      if (kept.length > 0) visit(file, lines, kept);
    }
  }
}

/** One page of hits ordered by path, line and column; snippets are built only for the returned page. */
export async function searchFiles(sources: SearchSources, query: SearchQuery, page: PageRequest): Promise<SearchResult> {
  const { context: _context, ...ordering } = query;
  const pager = new Pager<PendingHit>(page, { command: 'search', ...ordering }, hit => [hit.path, hit.line, hit.column]);
  await scanFiles(sources, query, (file, lines, hits) => {
    for (const hit of hits) pager.offer({ path: file.path, line: hit.line + 1, column: hit.column + 1, match: hit.match, revision: file.revision, lines });
  });
  const nextCursor = pager.nextCursor();
  return { hits: pager.items.map(hit => completed(hit, query.context)), total: pager.total, ...(nextCursor === undefined ? {} : { nextCursor }) };
}

/** One page of the files with hits in path order, each with its hit count, for `--files-only` and `--count`. */
export async function searchMatchingFiles(sources: SearchSources, query: SearchQuery, page: PageRequest): Promise<SearchFilesResult> {
  const { context: _context, ...ordering } = query;
  const pager = new Pager<SearchFile>(page, { command: 'search', output: 'files', ...ordering }, file => [file.path]);
  let total = 0;
  await scanFiles(sources, query, (file, _lines, hits) => {
    total += hits.length;
    pager.offer({ path: file.path, revision: file.revision, hits: hits.length });
  });
  const nextCursor = pager.nextCursor();
  return { files: pager.items, total, fileCount: pager.total, ...(nextCursor === undefined ? {} : { nextCursor }) };
}
