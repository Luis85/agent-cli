import type { MarkdownNode } from './markdown-references.ts';
import type { LineMap } from './positions.ts';

/** Offsets relative to the parsed body text. */
export interface Span { start: number; end: number }
export interface FoundSection extends Span { type: string; id?: string }
export interface FoundHeading extends Span { heading: string; level: number }
export interface FoundBlock extends Span { id: string }
export interface FoundListItem extends Span { parentLine: number | null; listLine: number; task?: string; id?: string }
export interface MarkdownStructure { sections: FoundSection[]; headings: FoundHeading[]; blocks: FoundBlock[]; listItems: FoundListItem[] }

const start = (node: MarkdownNode) => node.position?.start.offset ?? 0;
const end = (node: MarkdownNode) => node.position?.end.offset ?? 0;
const blockId = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const task = /^(?:[-*+]|\d+[.)])[ \t]+\[(.)\](?=[ \t]|$)/;

function sectionType(node: MarkdownNode, source: string): string {
  if (node.type === 'blockquote') return /^>\s*\[!/.test(source) ? 'callout' : 'blockquote';
  if (node.type === 'paragraph' && source.startsWith('$$')) return 'math';
  return node.type;
}

/**
 * Root sections, root headings, `^block` ids and list items of a parsed body. A paragraph's trailing `^id` names
 * the paragraph; a paragraph holding only `^id` names the preceding section, as Obsidian does for lists, quotes
 * and tables. A list item's trailing `^id` names the item.
 */
export function markdownStructure(text: string, tree: MarkdownNode, lines: LineMap): MarkdownStructure {
  const sections: FoundSection[] = [], headings: FoundHeading[] = [], blocks: FoundBlock[] = [], listItems: FoundListItem[] = [];
  const lastLineId = (span: Span) => blockId.exec(text.slice(Math.max(span.start, lines.lineStart(lines.line(span.end))), span.end))?.[1];
  for (const node of tree.children ?? []) {
    const span = { start: start(node), end: end(node) }, source = text.slice(span.start, span.end);
    const section: FoundSection = { type: sectionType(node, source), ...span };
    if (node.type === 'heading') {
      const children = node.children ?? [];
      headings.push({ heading: children.length ? text.slice(start(children[0]!), end(children.at(-1)!)) : '', level: node.depth ?? 1, ...span });
    }
    if (node.type === 'paragraph') {
      const id = lastLineId(span);
      const previous = sections.at(-1);
      if (id && previous && source.trim() === `^${id}`) { previous.id = id; blocks.push({ id, start: previous.start, end: previous.end }); }
      else if (id) { section.id = id; blocks.push({ id, ...span }); }
    }
    sections.push(section);
  }
  const items = (list: MarkdownNode, parentLine: number | null) => {
    const listLine = lines.line(start(list));
    for (const item of list.children ?? []) {
      const content = (item.children ?? []).filter(child => child.type !== 'list');
      const span = { start: start(item), end: content.length ? end(content.at(-1)!) : lines.lineEnd(lines.line(start(item))) };
      const marker = task.exec(text.slice(span.start, lines.lineEnd(lines.line(span.start))))?.[1];
      const id = content.length ? lastLineId(span) : undefined;
      listItems.push({ parentLine, listLine, ...span, ...(marker === undefined ? {} : { task: marker }), ...(id ? { id } : {}) });
      if (id) blocks.push({ id, ...span });
      for (const child of item.children ?? []) if (child.type === 'list') items(child, lines.line(span.start));
    }
  };
  const visit = (node: MarkdownNode) => {
    if (node.type === 'list') items(node, null);
    else if (node.type !== 'code') node.children?.forEach(visit);
  };
  visit(tree);
  return { sections, headings, blocks, listItems };
}
