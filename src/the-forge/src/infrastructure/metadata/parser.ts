import type { DocumentCodec } from '../../application/workspace/ports.ts';
import type { MetadataParser } from '../../application/metadata/ports.ts';
import { fileKind } from '../../domain/documents/file.ts';
import { isRecord } from '../../domain/shared/errors.ts';
import {
  defaultDisplayText, frontmatterAliases, parseLinktext, type BlockCache, type CachedMetadata, type CanvasLinkCache, type FrontmatterLinkCache, type LinkCache,
} from '../../domain/metadata/cache.ts';
import { blankComments, markdownReferences, parseMarkdown, stringReferences, type FoundReference } from './markdown-references.ts';
import { markdownStructure } from './markdown-structure.ts';
import { LineMap } from './positions.ts';

const nonEmpty = <Key extends keyof CachedMetadata>(key: Key, value: CachedMetadata[Key] & unknown[]) => (value.length ? { [key]: value } : {});

function frontmatterLinks(properties: Record<string, unknown>): FrontmatterLinkCache[] {
  const result: FrontmatterLinkCache[] = [];
  const visit = (value: unknown, key: string) => {
    if (typeof value === 'string') {
      for (const { embed, syntax, link, original, displayText, subpath } of stringReferences(value)) {
        result.push({ key, link, original, displayText, syntax, ...(subpath ? { subpath } : {}), ...(embed ? { embed } : {}) });
      }
    } else if (value && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) visit(item, key ? `${key}.${name}` : name);
    }
  };
  visit(properties, '');
  return result;
}

function markdownMetadata(content: string, properties: Record<string, unknown>, body: string): CachedMetadata {
  const bodyOffset = content.length - body.length, prefix = content.startsWith('﻿') ? 1 : 0;
  const lines = new LineMap(content), visible = blankComments(body), tree = parseMarkdown(visible);
  const at = (span: { start: number; end: number }) => ({ position: lines.pos(bodyOffset + span.start, bodyOffset + span.end) });
  const found = markdownReferences(visible, tree, true);
  const structure = markdownStructure(visible, tree, new LineMap(visible));
  const link = ({ syntax, link, original, displayText, subpath, reference, ...span }: FoundReference): LinkCache => ({
    link, original, displayText, syntax, ...(subpath ? { subpath } : {}), ...(reference === undefined ? {} : { reference }), ...at(span),
  });
  const result: CachedMetadata = {};
  const sections = structure.sections.map(({ type, id, ...span }) => ({ type, ...(id ? { id } : {}), ...at(span) }));
  if (bodyOffset > prefix) {
    const head = content.slice(0, bodyOffset);
    const end = bodyOffset - (head.endsWith('\r\n') ? 2 : /[\r\n]$/.test(head) ? 1 : 0);
    result.frontmatter = properties;
    result.frontmatterPosition = lines.pos(prefix, end);
    sections.unshift({ type: 'yaml', position: result.frontmatterPosition });
  }
  const firstBodyLine = lines.line(bodyOffset);
  // Subtraction keeps a list on line 0 at parent 0 rather than -0, which JSON cannot distinguish.
  const listItems = structure.listItems.map(({ parentLine, listLine, task, id, ...span }) => ({
    parent: parentLine === null ? 0 - (listLine + firstBodyLine) : parentLine + firstBodyLine,
    ...(task === undefined ? {} : { task }), ...(id ? { id } : {}), ...at(span),
  }));
  const blocks: Record<string, BlockCache> = {};
  for (const { id, ...span } of structure.blocks) blocks[id.toLowerCase()] ??= { id, ...at(span) };
  const aliases = frontmatterAliases(properties);
  return {
    ...nonEmpty('links', found.references.filter(item => !item.embed).map(link)),
    ...nonEmpty('embeds', found.references.filter(item => item.embed).map(link)),
    ...nonEmpty('frontmatterLinks', frontmatterLinks(properties)),
    ...nonEmpty('referenceLinks', found.definitions.map(({ id, link, original, ...span }) => ({ id, link, original, ...at(span) }))),
    ...nonEmpty('tags', found.tags.map(({ tag, ...span }) => ({ tag, ...at(span) }))),
    ...nonEmpty('headings', structure.headings.map(({ heading, level, ...span }) => ({ heading, level, ...at(span) }))),
    ...(Object.keys(blocks).length ? { blocks } : {}),
    ...nonEmpty('sections', sections),
    ...nonEmpty('listItems', listItems),
    ...result,
    ...(aliases.length ? { aliases } : {}),
  };
}

function canvasMetadata(data: Record<string, unknown>): CachedMetadata {
  const links: CanvasLinkCache[] = [];
  for (const node of Array.isArray(data.nodes) ? data.nodes : []) {
    if (!isRecord(node) || node.type !== 'file' || typeof node.file !== 'string' || typeof node.id !== 'string') continue;
    const link = node.file + (typeof node.subpath === 'string' ? node.subpath : '');
    const subpath = parseLinktext(link).subpath;
    links.push({ node: node.id, link, original: node.file, displayText: defaultDisplayText(link), syntax: 'canvas', ...(subpath ? { subpath } : {}) });
  }
  return nonEmpty('canvasLinks', links);
}

/** Parses Markdown and Canvas files through the document codec, which validates frontmatter and Canvas JSON. */
export class ObsidianMetadataParser implements MetadataParser {
  constructor(private readonly codec: DocumentCodec) {}

  indexes(path: string): boolean { return ['markdown', 'canvas'].includes(fileKind(path)); }

  parse(path: string, bytes: Uint8Array): CachedMetadata {
    if (fileKind(path) === 'canvas') return canvasMetadata((this.codec.inspect(path, bytes) as { data: Record<string, unknown> }).data);
    const document = this.codec.inspect(path, bytes) as { content: string; properties: Record<string, unknown>; body: string };
    return markdownMetadata(document.content, document.properties, document.body);
  }
}
