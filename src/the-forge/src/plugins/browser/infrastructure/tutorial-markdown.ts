import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { TutorialBlocks } from '../domain/tutorial.ts';

const parser = unified().use(remarkParse);
type MarkdownTree = ReturnType<typeof parser.parse>;
type MarkdownNode = MarkdownTree | MarkdownTree['children'][number];

/** Parse CommonMark once: code examples remain opaque, including any fences inside them. */
export const tutorialBlocks: TutorialBlocks = source => {
  const blocks: string[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === 'code' && node.lang === 'forge-tutorial' && !node.meta) blocks.push(node.value);
    if ('children' in node) node.children.forEach(visit);
  };
  visit(parser.parse(source));
  return blocks;
};
