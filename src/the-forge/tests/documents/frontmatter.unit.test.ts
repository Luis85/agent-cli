import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { parseMarkdownParts } from '../../src/infrastructure/documents/codec.ts';

/**
 * The previous frontmatter split, which parsed the whole note with remark-frontmatter to find the YAML node. The
 * line scanner must split every text exactly like it, including the texts it refuses.
 */
function remarkParts(source: string): unknown {
  const prefix = source.startsWith('﻿') ? '﻿' : '';
  const text = source.slice(prefix.length);
  const firstNode = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(text).children[0];
  const firstNewline = /\r\n|\n|\r/.exec(text);
  const opensFrontmatter = firstNewline !== null && text.slice(0, firstNewline.index).trimEnd() === '---';
  const newline = text.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  if (firstNode?.type !== 'yaml') {
    if (opensFrontmatter) return 'INVALID_FRONTMATTER';
    return { yaml: '', body: text, newline, exists: false, prefix };
  }
  const end = firstNode.position!.end.offset!;
  const closingLineStart = Math.max(text.lastIndexOf('\n', end - 1), text.lastIndexOf('\r', end - 1)) + 1;
  const separatorLength = text.startsWith('\r\n', end) ? 2 : text.startsWith('\n', end) || text.startsWith('\r', end) ? 1 : 0;
  return { yaml: text.slice(firstNewline!.index + firstNewline![0].length, closingLineStart), body: text.slice(end + separatorLength), newline, exists: true, prefix };
}

function scannedParts(text: string): unknown {
  try { return parseMarkdownParts(text); }
  catch (error) { return (error as { code?: string }).code; }
}

/** A deterministic pseudo-random sequence (linear congruential). */
function sequence(seed: number) {
  let state = seed;
  return (limit: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return Math.floor((state / 2147483648) * limit);
  };
}

describe('frontmatter detection', () => {
  const cases: Record<string, string> = {
    'LF': '---\ntitle: A\n---\n# Body\n',
    'CRLF': '---\r\ntitle: A\r\n---\r\n# Body\r\n',
    'CR only': '---\rtitle: A\r---\r# Body\r',
    'mixed line endings': '---\r\ntitle: A\n---\r# Body\n',
    'byte order mark': '﻿---\ntitle: A\n---\nBody',
    'empty frontmatter': '---\n---\nBody',
    'empty frontmatter at the end': '---\n---',
    'empty lines inside': '---\n\n\ntitle: A\n\n---\n\nBody',
    'closing fence at end of text': '---\ntitle: A\n---',
    'spaces and tabs after the fences': '--- \t\ntitle: A\n---\t  \nBody',
    'code fence inside the frontmatter': '---\nblock: |\n  ```\n---\n```\nBody',
    'fence in a body code block': '---\na: 1\n---\n```\n---\n```\n',
    'second frontmatter-like block': '---\na: 1\n---\n---\nb: 2\n---\n',
    'no frontmatter': '# Title\n---\nText',
    'thematic break later': 'Text\n\n---\n\nMore',
    'four dashes': '----\na: 1\n----\n',
    'indented opening fence': ' ---\na: 1\n---\n',
    'indented closing fence': '---\na: 1\n ---\nb: 2\n---\nBody',
    'closing fence with text': '---\na: 1\n--- x\n---\nBody',
    'closing fence with four dashes': '---\na: 1\n----\n---\nBody',
    'yaml document end marker': '---\na: 1\n...\nBody',
    'no closing fence': '---\ntitle: A\nBody',
    'opening fence only': '---\n',
    'dashes without newline': '---',
    'non-breaking space after the fence': '--- \na: 1\n---\n',
    'empty text': '',
    'list item': '- item\n---\n',
  };

  it.each(Object.entries(cases))('splits %s like remark-frontmatter', (_, text) => {
    expect(scannedParts(text)).toEqual(remarkParts(text));
  });

  it('keeps Obsidian-compatible results for the documented edge cases', () => {
    expect(parseMarkdownParts('﻿---\r\ntitle: A\r\n---\r\nBody')).toEqual({ prefix: '﻿', yaml: 'title: A\r\n', body: 'Body', newline: '\r\n', exists: true });
    expect(parseMarkdownParts('---\n---\nBody')).toMatchObject({ exists: true, yaml: '', body: 'Body' });
    expect(parseMarkdownParts('---\nblock: |\n  ```\n---\n```\n')).toMatchObject({ yaml: 'block: |\n  ```\n', body: '```\n' });
    expect(() => parseMarkdownParts('---\ntitle: A\nBody')).toThrow(expect.objectContaining({ code: 'INVALID_FRONTMATTER' }));
  });

  it('splits generated texts exactly like remark-frontmatter', () => {
    const pick = sequence(11);
    const pieces = ['---', '--- ', '---\t', '----', ' ---', '-- -', 'a: 1', '```', '', '...', '# H', ' ', 'x'];
    const endings = ['\n', '\r\n', '\r'];
    for (let attempt = 0; attempt < 600; attempt++) {
      const lines = Array.from({ length: 1 + pick(7) }, (_, index) => (index === 0 && pick(3) > 0 ? '---' : pieces[pick(pieces.length)]!));
      const text = (pick(5) === 0 ? '﻿' : '') + lines.map(line => line + endings[pick(endings.length)]).join('').slice(0, pick(4) === 0 ? -1 : undefined);
      expect(scannedParts(text), JSON.stringify(text)).toEqual(remarkParts(text));
    }
  });
});
