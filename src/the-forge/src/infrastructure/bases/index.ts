import { stat } from 'node:fs/promises';
import { frontmatterLink, type ContextFileInput, type LinkValueInput, type PropertyValueType } from 'obsidian-bases-expression';
import type { MetadataCache, SourceReference } from '../../application/metadata/ports.ts';
import { allTags } from '../../domain/metadata/cache.ts';
import { forgeError, AppError, ensure, isRecord } from '../../domain/shared/errors.ts';
import { NodeFiles } from '../workspace/files.ts';

const pendingFileReads = 16;
const isMarkdown = (path: string) => path.toLowerCase().endsWith('.md');

function typedLinks(value: unknown, source: string, cache: MetadataCache): unknown {
  if (typeof value === 'string') {
    const match = /^\[\[([^\]]+)\]\]$/.exec(value);
    if (!match) return value;
    const [target, display] = match[1]!.split('|');
    return frontmatterLink(target!, display, cache.getFirstLinkpathDest(target!, source));
  }
  if (Array.isArray(value)) return value.map(item => typedLinks(item, source, cache));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typedLinks(item, source, cache)]));
  return value;
}

// Bases resolve by path only: an alias match stays unresolved, and an ambiguous path match fails the query.
function baseLink({ reference, resolution }: SourceReference, source: string): LinkValueInput {
  if (resolution.status === 'unresolved' && resolution.reason === 'ambiguous' && resolution.via === 'path') {
    throw forgeError('AMBIGUOUS_BASE_LINK', `Link ${resolution.linkpath} in ${source} matches multiple files: ${resolution.candidates.join(', ')}`);
  }
  return { path: reference.link, resolvedPath: resolution.status === 'resolved' && resolution.via === 'path' ? resolution.path : null };
}

// Keeps at most `limit` items in flight and returns results in input order. Items start in order and
// workers stop taking new ones after a failure, so the earliest failing item's error is thrown, as with
// one-by-one awaiting.
async function mapInOrder<Item, Result>(items: readonly Item[], limit: number, map: (item: Item) => Promise<Result>): Promise<Result[]> {
  const results: Result[] = [], failures = new Map<number, unknown>();
  let next = 0;
  const work = async () => {
    while (failures.size === 0 && next < items.length) {
      const position = next++;
      try { results[position] = await map(items[position]!); }
      catch (error) { failures.set(position, error); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, work));
  if (failures.size > 0) throw failures.get(Math.min(...failures.keys()));
  return results;
}

/** File inputs for a Markdown note or an attachment; Canvas file nodes are not Bases links. */
function baseFile(path: string, cache: MetadataCache, problems: ReadonlyMap<string, string>): Omit<ContextFileInput, 'size' | 'ctime' | 'mtime'> {
  if (!isMarkdown(path)) return { path, properties: {}, links: [], embeds: [], tags: [], backlinks: [] };
  const problem = problems.get(path);
  if (problem !== undefined) throw forgeError('BASE_INDEX_ERROR', `Cannot index ${path}: ${problem}`);
  const references = cache.references(path), metadata = cache.getFileCache(path);
  const links = references.map(item => baseLink(item, path));
  const embeds = links.filter((_, position) => {
    const item = references[position]!;
    return item.kind === 'embed' || (item.kind === 'frontmatter' && item.reference.embed === true);
  });
  return { path, properties: typedLinks(metadata?.frontmatter ?? {}, path, cache) as Record<string, unknown>, links, embeds, tags: allTags(metadata), backlinks: [] };
}

/** Adapts the kernel metadata cache to the evaluator's file inputs, adding filesystem sizes and dates. */
export async function indexBaseFiles(files: NodeFiles, cache: MetadataCache): Promise<ContextFileInput[]> {
  const problems = new Map(cache.issues().map(issue => [issue.path, issue.message]));
  const indexed = cache.files().map(path => baseFile(path, cache, problems));
  const result = await mapInOrder(indexed, pendingFileReads, async (file): Promise<ContextFileInput> => {
    const info = await stat(await files.resolvePath(file.path!));
    return { ...file, size: info.size, ctime: info.birthtime, mtime: info.mtime };
  });
  const byPath = new Map(result.map(file => [file.path, file]));
  for (const source of result) {
    for (const target of new Set(source.links?.map(link => link.resolvedPath).filter((path): path is string => Boolean(path)))) {
      byPath.get(target)?.backlinks?.push({ path: source.path, resolvedPath: source.path });
    }
  }
  return result;
}

export async function basePropertyTypes(files: NodeFiles): Promise<Record<string, PropertyValueType>> {
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode((await files.read('.obsidian/types.json')).bytes)); }
  catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') return {};
    if (error instanceof SyntaxError) throw forgeError('INVALID_BASE_PROPERTY_TYPES', '.obsidian/types.json must contain valid JSON.');
    throw error;
  }
  ensure(isRecord(data) && isRecord(data.types), 'INVALID_BASE_PROPERTY_TYPES', '.obsidian/types.json must contain a types mapping.');
  const names: Record<string, PropertyValueType> = { text: 'string', multitext: 'list', tags: 'list', aliases: 'list', number: 'number', checkbox: 'boolean', date: 'date', datetime: 'date' };
  const result: Record<string, PropertyValueType> = {};
  for (const [property, type] of Object.entries(data.types)) {
    ensure(typeof type === 'string' && Object.hasOwn(names, type), 'UNSUPPORTED_BASE_PROPERTY_TYPE', `Unsupported Obsidian property type for ${property}: ${String(type)}`);
    result[property] = names[type]!;
  }
  return result;
}
