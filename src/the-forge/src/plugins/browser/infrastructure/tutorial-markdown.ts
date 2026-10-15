import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { TutorialBlocks } from '../domain/tutorial.ts';

const parser = unified().use(remarkParse);
type MarkdownTree = ReturnType<typeof parser.parse>;
type MarkdownNode = MarkdownTree | MarkdownTree['children'][number];

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  if ('children' in node) for (const child of node.children) walk(child, visit);
}

/**
 * Replaces Obsidian `%%comments%%` with spaces, keeping line breaks. A `%%` inside code is literal, as in Obsidian;
 * one outside code opens a comment that hides everything, fences included, up to the next `%%` or the end of the text.
 * A `%%` after an odd number of backslashes is escaped: it neither opens nor closes a comment.
 */
function blankObsidianComments(source: string): string {
  if (!source.includes('%%')) return source;
  const code: Array<[number, number]> = [];
  walk(parser.parse(source), node => {
    if ((node.type === 'code' || node.type === 'inlineCode') && node.position) code.push([node.position.start.offset ?? 0, node.position.end.offset ?? 0]);
  });
  const marker = (from: number): number => {
    for (let at = source.indexOf('%%', from); at !== -1; at = source.indexOf('%%', at + 2)) {
      let backslashes = 0;
      while (source[at - backslashes - 1] === '\\') backslashes++;
      if (backslashes % 2 === 0) return at;
    }
    return -1;
  };
  let visible = '', cursor = 0;
  for (let open = marker(0); open !== -1; open = marker(cursor)) {
    const span = code.find(([start, end]) => open >= start && open < end);
    if (span) { visible += source.slice(cursor, span[1]); cursor = span[1]; continue; }
    const close = marker(open + 2), stop = close === -1 ? source.length : close + 2;
    visible += source.slice(cursor, open) + source.slice(open, stop).replace(/[^\r\n]/g, ' ');
    cursor = stop;
  }
  return visible + source.slice(cursor);
}

/** Parse CommonMark once comments are hidden: code examples remain opaque, including any fences inside them. */
export const tutorialBlocks: TutorialBlocks = source => {
  const blocks: string[] = [];
  walk(parser.parse(blankObsidianComments(source)), node => {
    if (node.type === 'code' && node.lang === 'forge-tutorial' && !node.meta) blocks.push(node.value);
  });
  return blocks;
};
