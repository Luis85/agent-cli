import { stat } from 'node:fs/promises';
import { frontmatterLink, type ContextFileInput, type PropertyValueType } from 'obsidian-bases-expression';
import type { DocumentCodec } from '../application/ports.ts';
import { AppError, ensure, isRecord } from '../domain/errors.ts';
import { NodeFiles } from './files.ts';
import { indexBaseLinks, resolveBaseLink } from './bases-links.ts';

function typedLinks(value: unknown, source: string, paths: string[]): unknown {
  if (typeof value === 'string') {
    const match = /^\[\[([^\]]+)\]\]$/.exec(value);
    if (!match) return value;
    const [target, display] = match[1]!.split('|');
    return frontmatterLink(target!, display, resolveBaseLink(target!, source, paths));
  }
  if (Array.isArray(value)) return value.map(item => typedLinks(item, source, paths));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typedLinks(item, source, paths)]));
  return value;
}

export async function indexBaseFiles(files: NodeFiles, codec: DocumentCodec): Promise<ContextFileInput[]> {
  const paths = (await files.list()).filter(path => !path.split('/').some(part => part.startsWith('.')));
  const result: ContextFileInput[] = [];
  for (const path of paths) {
    const info = await stat(await files.resolvePath(path));
    let properties: Record<string, unknown> = {}, body = '';
    if (path.toLowerCase().endsWith('.md')) {
      try {
        const document = codec.inspect(path, (await files.read(path)).bytes) as { properties: Record<string, unknown>; body: string };
        properties = document.properties; body = document.body;
      } catch (error) {
        throw new AppError('BASE_INDEX_ERROR', `Cannot index ${path}: ${error instanceof Error ? error.message : String(error)}`, 2);
      }
    }
    const links = indexBaseLinks(body, properties, path, paths);
    result.push({ path, properties: typedLinks(properties, path, paths) as Record<string, unknown>, size: info.size, ctime: info.birthtime, mtime: info.mtime, ...links, backlinks: [] });
  }
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
    if (error instanceof SyntaxError) throw new AppError('INVALID_BASE_PROPERTY_TYPES', '.obsidian/types.json must contain valid JSON.', 2);
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
