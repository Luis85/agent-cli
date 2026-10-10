import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { defaultDisplayText, parseLinktext, type LinkSyntax } from '../../domain/metadata/cache.ts';
import { isExternalLink } from '../../domain/metadata/link-resolution.ts';
import { LineMap } from './positions.ts';

interface Point { line: number; offset?: number }
export interface MarkdownNode {
  type: string; value?: string; url?: string; identifier?: string; label?: string; alt?: string; depth?: number;
  children?: MarkdownNode[]; position?: { start: Point; end: Point };
}
/** A reference found in parsed text; offsets are relative to that text. */
export interface FoundReference {
  syntax: LinkSyntax; embed: boolean; link: string; original: string; displayText: string; subpath?: string; reference?: string;
  start: number; end: number;
}
export interface FoundTag { tag: string; start: number; end: number }
export interface FoundDefinition { id: string; link: string; original: string; start: number; end: number }
export interface MarkdownReferences { references: FoundReference[]; tags: FoundTag[]; definitions: FoundDefinition[] }

const parser = unified().use(remarkParse);
const blank = (text: string) => text.replace(/[^\r\n]/g, ' ');
// Display math, then inline math whose delimiters hug non-space text and whose closing `$` precedes no digit.
const math = /(?<!\\)\$\$[\s\S]*?\$\$|(?<!\\)\$(?![\s$])(?:\\.|[^\\$\n])*?(?<![\s\\])\$(?!\d)/g;
const start = (node: MarkdownNode) => node.position?.start.offset ?? 0;
const end = (node: MarkdownNode) => node.position?.end.offset ?? 0;

/** Replaces `%%comments%%` with spaces so offsets and line numbers stay valid while their content is ignored. */
export function blankComments(value: string): string { return value.replace(/%%[\s\S]*?%%/g, blank); }
export function parseMarkdown(value: string): MarkdownNode { return parser.parse(value) as MarkdownNode; }

function decoded(target: string): string {
  try { return decodeURI(target); } catch { return target; /* Malformed percent escapes stay literal unresolved targets. */ }
}

function childText(value: string, node: MarkdownNode): string {
  const children = node.children ?? [];
  return children.length ? value.slice(start(children[0]!), end(children.at(-1)!)) : node.alt ?? '';
}

/**
 * Finds links, embeds, inline tags and reference definitions in Markdown text, skipping code, comments (when
 * blanked first), math, escaped syntax and external URLs. `inlineTags` is false for frontmatter strings.
 */
export function markdownReferences(value: string, tree: MarkdownNode, inlineTags: boolean): MarkdownReferences {
  const references: FoundReference[] = [], tags: FoundTag[] = [], definitions: FoundDefinition[] = [];
  const targets = new Map<string, string>();
  let lines: LineMap | undefined;
  const add = (target: string, embed: boolean, syntax: LinkSyntax, found: Omit<FoundReference, 'syntax' | 'embed' | 'link' | 'subpath' | 'displayText'> & { displayText?: string }) => {
    if (isExternalLink(target)) return;
    const link = syntax === 'wikilink' ? target : decoded(target);
    const subpath = parseLinktext(link).subpath;
    references.push({ syntax, embed, link, ...found, displayText: found.displayText ?? defaultDisplayText(link), ...(subpath ? { subpath } : {}) });
  };
  const text = (slice: string, base: number) => {
    const escaped = (index: number) => {
      let slashes = 0;
      while (index > 0 && slice[--index] === '\\') slashes++;
      return slashes % 2 === 1;
    };
    const visible = slice.includes('$') ? slice.replace(math, blank) : slice;
    for (const match of visible.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
      if (escaped(match.index + match[1]!.length)) continue;
      const inner = match[2]!, pipe = inner.indexOf('|');
      add(pipe < 0 ? inner : inner.slice(0, pipe), match[1] === '!', 'wikilink', {
        original: match[0], start: base + match.index, end: base + match.index + match[0].length,
        ...(pipe < 0 ? {} : { displayText: inner.slice(pipe + 1) }),
      });
    }
    if (inlineTags) for (const match of visible.matchAll(/(?:^|[\s(])#([\p{L}\p{N}\p{M}\p{S}_/-]+)/gu)) {
      const hash = match.index + match[0].indexOf('#');
      if (!/^\p{N}+$/u.test(match[1]!) && !escaped(hash)) tags.push({ tag: '#' + match[1]!, start: base + hash, end: base + hash + 1 + match[1]!.length });
    }
  };
  // Maps an offset in an HTML node's value back to the source, whose lines may carry container prefixes such as `> `.
  const htmlOffset = (node: MarkdownNode, offset: number): number => {
    const html = node.value!;
    if (value.slice(start(node), end(node)) === html) return start(node) + offset;
    lines ??= new LineMap(value);
    const before = html.slice(0, offset).split(/\r\n|\n|\r/);
    const line = (node.position?.start.line ?? 1) - 1 + before.length - 1;
    const valueLine = html.split(/\r\n|\n|\r/)[before.length - 1] ?? '';
    const prefix = Math.max(0, lines.lineEnd(line) - lines.lineStart(line) - valueLine.length);
    return lines.lineStart(line) + (before.length === 1 ? start(node) - lines.lineStart(line) : prefix) + before.at(-1)!.length;
  };
  const html = (node: MarkdownNode, element: DefaultTreeAdapterTypes.Node) => {
    if ('tagName' in element) {
      if (['script', 'style', 'code', 'pre'].includes(element.tagName)) return;
      const attribute = element.tagName === 'a' ? 'href' : ['img', 'audio', 'video', 'source', 'iframe'].includes(element.tagName) ? 'src' : undefined;
      const target = element.attrs.find(item => item.name === attribute)?.value;
      if (target) {
        const location = element.sourceCodeLocation?.attrs?.[attribute!];
        const [from, to] = location ? [location.startOffset, location.endOffset] : [0, node.value!.length];
        add(target, element.tagName !== 'a', 'html', { original: node.value!.slice(from, to), start: htmlOffset(node, from), end: htmlOffset(node, to) });
      }
    }
    if ('childNodes' in element) element.childNodes.forEach(child => html(node, child));
  };
  const collect = (node: MarkdownNode) => {
    if (node.type === 'definition' && node.identifier && node.url) {
      targets.set(node.identifier, node.url);
      if (!isExternalLink(node.url)) definitions.push({ id: node.label ?? node.identifier, link: decoded(node.url), original: value.slice(start(node), end(node)), start: start(node), end: end(node) });
    }
    node.children?.forEach(collect);
  };
  const walk = (node: MarkdownNode) => {
    if (['code', 'inlineCode', 'definition'].includes(node.type)) return;
    if (node.type === 'html' && node.value) { html(node, parseFragment(node.value, { sourceCodeLocationInfo: true })); return; }
    const found = () => ({ original: value.slice(start(node), end(node)), start: start(node), end: end(node), displayText: childText(value, node) });
    if (node.type === 'text' && node.value) text(value.slice(start(node), end(node)), start(node));
    if (['link', 'image'].includes(node.type) && node.url) add(node.url, node.type === 'image', 'markdown', found());
    if (['linkReference', 'imageReference'].includes(node.type) && node.identifier) {
      const target = targets.get(node.identifier);
      if (target) add(target, node.type === 'imageReference', 'reference', { ...found(), reference: node.label ?? node.identifier });
    }
    node.children?.forEach(walk);
  };
  collect(tree);
  walk(tree);
  return { references, tags, definitions };
}

/** References in one frontmatter string, which has no inline tags; text without `[` or `<` cannot hold one. */
export function stringReferences(value: string): FoundReference[] {
  if (!/[[<]/.test(value)) return [];
  const visible = blankComments(value);
  return markdownReferences(visible, parseMarkdown(visible), false).references;
}
