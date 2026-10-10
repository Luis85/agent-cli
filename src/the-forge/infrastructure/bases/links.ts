import { posix } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { LinkValueInput } from 'obsidian-bases-expression';
import { forgeError } from '../../domain/shared/errors.ts';

interface MarkdownNode { type: string; value?: string; url?: string; identifier?: string; children?: MarkdownNode[]; position?: { start: { offset?: number }; end: { offset?: number } } }
export interface IndexedLinks { links: LinkValueInput[]; embeds: LinkValueInput[]; tags: string[] }
const parser = unified().use(remarkParse);
const external = (target: string) => /^[a-z][a-z\d+.-]*:|^\/\//i.test(target);

/** Vault paths in index order, keyed by exact spelling, lowercase spelling and each lowercase suffix that follows a `/`. */
export interface BaseLinkIndex { paths: readonly string[]; exact: ReadonlySet<string>; lower: ReadonlyMap<string, number[]>; suffixes: ReadonlyMap<string, number[]> }

export function baseLinkIndex(paths: readonly string[]): BaseLinkIndex {
  const lower = new Map<string, number[]>(), suffixes = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, position: number) => {
    const positions = map.get(key);
    if (positions) positions.push(position);
    else map.set(key, [position]);
  };
  for (const [position, path] of paths.entries()) {
    const folded = path.toLowerCase();
    add(lower, folded, position);
    for (let slash = folded.indexOf('/'); slash >= 0; slash = folded.indexOf('/', slash + 1)) add(suffixes, folded.slice(slash + 1), position);
  }
  return { paths, exact: new Set(paths), lower, suffixes };
}

// Paths whose key equals the lowercase spelling with or without `.md`, in vault path order.
function lookup(index: BaseLinkIndex, keys: ReadonlyMap<string, number[]>, spelling: string): string[] {
  const positions = new Set([...keys.get(spelling.toLowerCase()) ?? [], ...keys.get(`${spelling}.md`.toLowerCase()) ?? []]);
  return [...positions].sort((a, b) => a - b).map(position => index.paths[position]!);
}

export function resolveBaseLink(target: string, source: string, index: BaseLinkIndex, relative = false): string | null {
  target = target.split('#')[0] ?? '';
  if (!target) return source;
  if (external(target)) return null;
  target = target.replace(/^\//, '');
  const directory = posix.dirname(source);
  const local = posix.normalize(posix.join(directory, target));
  const candidates = relative ? [local, target] : [target, local];
  for (const candidate of candidates) {
    for (const spelling of [candidate, `${candidate}.md`]) {
      if (index.exact.has(spelling)) return spelling;
    }
  }
  for (const candidate of candidates) {
    const found = lookup(index, index.lower, candidate);
    if (found.length === 1) return found[0]!;
    if (found.length > 1) throw forgeError('AMBIGUOUS_BASE_LINK', `Link ${target} in ${source} matches multiple files: ${found.join(', ')}`);
  }
  if (relative || target.startsWith('../')) return null;
  const matches = lookup(index, index.suffixes, target);
  if (matches.length > 1) throw forgeError('AMBIGUOUS_BASE_LINK', `Link ${target} in ${source} matches multiple files: ${matches.join(', ')}`);
  return matches[0] ?? null;
}

export function indexBaseLinks(body: string, properties: Record<string, unknown>, source: string, paths: BaseLinkIndex): IndexedLinks {
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
    // Every link form needs a literal `[` or `<` and inline tags need `#`; skip text that has none.
    if (!/[[<]/.test(value) && !(inlineTags && value.includes('#'))) return;
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
