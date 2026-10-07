import { posix } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { LinkValueInput } from 'obsidian-bases-expression';
import { AppError } from '../domain/errors.ts';

interface MarkdownNode { type: string; value?: string; url?: string; identifier?: string; children?: MarkdownNode[]; position?: { start: { offset?: number }; end: { offset?: number } } }
export interface IndexedLinks { links: LinkValueInput[]; embeds: LinkValueInput[]; tags: string[] }
const parser = unified().use(remarkParse);
const external = (target: string) => /^[a-z][a-z\d+.-]*:|^\/\//i.test(target);

export function resolveBaseLink(target: string, source: string, paths: readonly string[], relative = false): string | null {
  target = target.split('#')[0] ?? '';
  if (!target) return source;
  if (external(target)) return null;
  target = target.replace(/^\//, '');
  const directory = posix.dirname(source);
  const local = posix.normalize(posix.join(directory, target));
  const candidates = relative ? [local, target] : [target, local];
  for (const candidate of candidates) {
    for (const spelling of [candidate, `${candidate}.md`]) {
      const exact = paths.find(path => path === spelling);
      if (exact) return exact;
    }
  }
  for (const candidate of candidates) {
    const found = paths.filter(path => [candidate, `${candidate}.md`].some(spelling => path.toLowerCase() === spelling.toLowerCase()));
    if (found.length === 1) return found[0]!;
    if (found.length > 1) throw new AppError('AMBIGUOUS_BASE_LINK', `Link ${target} in ${source} matches multiple files: ${found.join(', ')}`, 2);
  }
  if (relative || target.startsWith('../')) return null;
  const matches = paths.filter(path => [target, `${target}.md`].some(spelling => path.toLowerCase().endsWith('/' + spelling.toLowerCase())));
  if (matches.length > 1) throw new AppError('AMBIGUOUS_BASE_LINK', `Link ${target} in ${source} matches multiple files: ${matches.join(', ')}`, 2);
  return matches[0] ?? null;
}

export function indexBaseLinks(body: string, properties: Record<string, unknown>, source: string, paths: readonly string[]): IndexedLinks {
  const links: LinkValueInput[] = [], embeds: LinkValueInput[] = [], tags = new Set<string>();
  const add = (target: string, embedded: boolean, relative: boolean) => {
    if (external(target)) return;
    if (relative) { try { target = decodeURI(target); } catch { /* Preserve malformed percent escapes as literal unresolved targets. */ } }
    const link: LinkValueInput = { path: target, resolvedPath: resolveBaseLink(target, source, paths, relative) };
    links.push(link);
    if (embedded) embeds.push(link);
  };
  const text = (value: string, inlineTags: boolean) => {
    const escaped = (index: number) => {
      let slashes = 0;
      while (index > 0 && value[--index] === '\\') slashes++;
      return slashes % 2 === 1;
    };
    for (const match of value.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
      if (!escaped(match.index + match[1]!.length)) add(match[2]!.split('|')[0]!, match[1] === '!', false);
    }
    if (inlineTags) for (const match of value.matchAll(/(?:^|[\s(])#([\p{L}\p{N}\p{M}\p{S}_/-]+)/gu)) {
      if (!/^\p{N}+$/u.test(match[1]!) && !escaped(match.index + match[0].indexOf('#'))) tags.add('#' + match[1]!);
    }
  };
  const parse = (value: string, inlineTags: boolean) => {
    value = value.replace(/%%[\s\S]*?%%/g, comment => comment.replace(/[^\r\n]/g, ' '));
    const tree = parser.parse(value) as MarkdownNode;
    const definitions = new Map<string, string>();
    const collect = (node: MarkdownNode) => {
      if (node.type === 'definition' && node.identifier && node.url) definitions.set(node.identifier, node.url);
      node.children?.forEach(collect);
    };
    collect(tree);
    const html = (node: DefaultTreeAdapterTypes.Node) => {
      if ('tagName' in node) {
        if (['script', 'style', 'code', 'pre'].includes(node.tagName)) return;
        const attribute = node.tagName === 'a' ? 'href' : ['img', 'audio', 'video', 'source', 'iframe'].includes(node.tagName) ? 'src' : undefined;
        const target = node.attrs.find(item => item.name === attribute)?.value;
        if (target) add(target, node.tagName !== 'a', true);
      }
      if ('childNodes' in node) node.childNodes.forEach(html);
    };
    const walk = (node: MarkdownNode) => {
      if (['code', 'inlineCode', 'definition'].includes(node.type)) return;
      if (node.type === 'html' && node.value) { html(parseFragment(node.value)); return; }
      if (node.type === 'text' && node.value) text(value.slice(node.position?.start.offset, node.position?.end.offset), inlineTags);
      if (['link', 'image'].includes(node.type) && node.url) add(node.url, node.type === 'image', true);
      if (['linkReference', 'imageReference'].includes(node.type) && node.identifier) {
        const target = definitions.get(node.identifier);
        if (target) add(target, node.type === 'imageReference', true);
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
  parse(body, true);
  const frontmatter = (value: unknown) => {
    if (typeof value === 'string') parse(value, false);
    else if (value && typeof value === 'object') Object.values(value).forEach(frontmatter);
  };
  frontmatter(properties);
  const rawTags = properties.tags ?? properties.tag;
  for (const tag of Array.isArray(rawTags) ? rawTags : typeof rawTags === 'string' ? rawTags.split(/[,\s]+/) : []) {
    if (typeof tag === 'string' && tag.length) tags.add('#' + tag.replace(/^#/, ''));
  }
  return { links, embeds, tags: [...tags] };
}
