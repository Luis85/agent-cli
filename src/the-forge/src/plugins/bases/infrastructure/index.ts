import { frontmatterLink, type ContextFileInput, type LinkValueInput, type PropertyValueType } from 'obsidian-bases-expression';
import type { MetadataCache, SourceReference } from '../../../application/metadata/ports.ts';
import type { FileDates } from '../../../application/plugins/core-plugins.ts';
import type { FileRepository } from '../../../application/workspace/ports.ts';
import { allTags } from '../../../domain/metadata/cache.ts';
import { closestDestination } from '../../../domain/metadata/link-resolution.ts';
import { forgeError, AppError, ensure, isRecord } from '../../../domain/shared/errors.ts';
import type { BaseIndexWarning } from '../application/query.ts';

const pendingFileReads = 16;
const isMarkdown = (path: string) => path.toLowerCase().endsWith('.md');

function typedLinks(value: unknown, source: string, cache: MetadataCache): unknown {
  if (typeof value === 'string') {
    const match = /^\[\[([^\]]+)\]\]$/.exec(value);
    if (!match) return value;
    const [target, display] = match[1]!.split('|');
    return frontmatterLink(target!, display, cache.getClosestLinkpathDest(target!, source));
  }
  if (Array.isArray(value)) return value.map(item => typedLinks(item, source, cache));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typedLinks(item, source, cache)]));
  return value;
}

/** The indexed files in vault path order and what could not be fully indexed. */
export interface BaseIndex { files: ContextFileInput[]; warnings: BaseIndexWarning[] }

// Bases resolve by path only: an alias match stays unresolved, and an ambiguous path match opens the closest file.
function baseLink({ reference, resolution }: SourceReference, source: string, warnings: BaseIndexWarning[]): LinkValueInput {
  const resolvedPath = closestDestination(resolution, source);
  if (resolution.status === 'unresolved' && resolution.reason === 'ambiguous' && resolvedPath !== null) {
    warnings.push({
      code: 'ambiguous-link', path: source, link: resolution.linkpath, candidates: resolution.candidates, resolvedPath,
      message: `Link ${resolution.linkpath} in ${source} matches ${resolution.candidates.join(', ')}; it resolves to the closest, ${resolvedPath}.`,
    });
  }
  return { path: reference.link, resolvedPath };
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

/**
 * File inputs for a Markdown note or an attachment; Canvas file nodes are not Bases links. A note the metadata
 * cache could not parse is indexed like an attachment, without properties, links or tags.
 */
function baseFile(path: string, cache: MetadataCache, problems: ReadonlyMap<string, string>, warnings: BaseIndexWarning[]): Omit<ContextFileInput, 'size' | 'ctime' | 'mtime'> {
  const bare = { path, properties: {}, links: [], embeds: [], tags: [], backlinks: [] };
  if (!isMarkdown(path)) return bare;
  const problem = problems.get(path);
  if (problem !== undefined) {
    warnings.push({ code: 'unparseable-note', path, message: `${path} cannot be parsed and is indexed without properties, links or tags: ${problem}` });
    return bare;
  }
  const references = cache.references(path), metadata = cache.getFileCache(path);
  const links = references.map(item => baseLink(item, path, warnings));
  const embeds = links.filter((_, position) => {
    const item = references[position]!;
    return item.kind === 'embed' || (item.kind === 'frontmatter' && item.reference.embed === true);
  });
  return { path, properties: typedLinks(metadata?.frontmatter ?? {}, path, cache) as Record<string, unknown>, links, embeds, tags: allTags(metadata), backlinks: [] };
}

/**
 * Adapts the kernel metadata cache to the evaluator's file inputs, adding filesystem sizes and dates. A note that
 * cannot be fully indexed degrades on its own and is reported in `warnings`, in vault path order.
 */
async function indexBaseFiles(cache: MetadataCache, dates: (path: string) => Promise<FileDates>): Promise<BaseIndex> {
  const problems = new Map(cache.issues().map(issue => [issue.path, issue.message]));
  const warnings: BaseIndexWarning[] = [];
  const indexed = cache.files().map(path => baseFile(path, cache, problems, warnings));
  const files = await mapInOrder(indexed, pendingFileReads, async (file): Promise<ContextFileInput> => {
    const { size, ctime, mtime } = await dates(file.path!);
    return { ...file, size, ctime, mtime };
  });
  const byPath = new Map(files.map(file => [file.path, file]));
  for (const source of files) {
    for (const target of new Set(source.links?.map(link => link.resolvedPath).filter((path): path is string => Boolean(path)))) {
      byPath.get(target)?.backlinks?.push({ path: source.path, resolvedPath: source.path });
    }
  }
  return { files, warnings };
}

const indexes = new WeakMap<MetadataCache, { files: readonly string[]; index: Promise<BaseIndex> }>();
/**
 * `indexBaseFiles`, shared by every query over the same, unchanged metadata cache: the backlog's view and its
 * release view in one invocation index the vault once. Any metadata update replaces `cache.files()`, which starts
 * a new index.
 */
export function sharedBaseIndex(cache: MetadataCache, dates: (path: string) => Promise<FileDates>): Promise<BaseIndex> {
  const cached = indexes.get(cache);
  if (cached !== undefined && cached.files === cache.files()) return cached.index;
  const index = indexBaseFiles(cache, dates);
  indexes.set(cache, { files: cache.files(), index });
  index.catch(() => { if (indexes.get(cache)?.index === index) indexes.delete(cache); });
  return index;
}

export async function basePropertyTypes(files: FileRepository): Promise<Record<string, PropertyValueType>> {
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
