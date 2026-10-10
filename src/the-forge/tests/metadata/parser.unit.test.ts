import { describe, expect, it } from 'vitest';
import { allTags, type CachedMetadata, type Pos } from '../../src/domain/metadata/cache.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';
import { ObsidianMetadataParser } from '../../src/infrastructure/metadata/parser.ts';

const parser = new ObsidianMetadataParser(new ObsidianDocuments());
const parse = (path: string, text: string): CachedMetadata => parser.parse(path, new TextEncoder().encode(text));
// Each position must slice exactly the text it describes, with line/column matching the offset.
const at = (text: string, position: Pos) => {
  const lineStarts = [0, ...Array.from(text.matchAll(/\r\n|\n|\r/g), match => match.index + match[0].length)];
  for (const point of [position.start, position.end]) expect(lineStarts[point.line]! + point.col, `line ${point.line} col ${point.col}`).toBe(point.offset);
  return text.slice(position.start.offset, position.end.offset);
};

const note = [
  '---',
  'aliases: [Roadmap, "Q4 goals"]',
  'tags: [work/plan]',
  'owner: "[[People/Ada|Ada]]"',
  'related: ["[[Plan#Scope]]", "![[diagram.png]]", "[web](https://example.com)"]',
  '---',
  '# Title with [[Inline]]',
  '',
  'See [[Plan#Scope|the scope]] and ![[Sketch.canvas]] plus [doc](../Docs/Read%20Me.md#Intro) #tag/one.',
  'Ref [text][spec], [[Plan#^block-1]] and `[[Code]] #code` %% [[Hidden]] #hidden %% $[[Math]] #math$ \\#esc \\[[Escaped]] #2026',
  '',
  '[spec]: Specs/Spec.md',
  '[web]: https://example.com/spec',
  '',
  '## Tasks',
  '',
  '- [ ] open task ^task-1',
  '  - [x] nested done',
  '- plain item',
  '',
  'Paragraph with block ^para-1',
  '',
  '> [!note] Callout',
  '> <a href="Target.md">t</a><img src="https://example.com/x.png">',
  '',
  '^quote-id',
  '',
  '```md',
  '[[Fenced]] #fenced',
  '```',
  '$$',
  '[[Display]]',
  '$$',
].join('\n');

describe('Markdown metadata parsing', () => {
  const cache = parse('Notes/Note.md', note);

  it('indexes wikilinks, Markdown, reference and HTML links with display text, subpaths and exact positions', () => {
    expect(cache.links?.map(({ position, ...link }) => ({ ...link, source: at(note, position) }))).toEqual([
      { link: 'Inline', original: '[[Inline]]', displayText: 'Inline', syntax: 'wikilink', source: '[[Inline]]' },
      { link: 'Plan#Scope', original: '[[Plan#Scope|the scope]]', displayText: 'the scope', subpath: '#Scope', syntax: 'wikilink', source: '[[Plan#Scope|the scope]]' },
      { link: '../Docs/Read Me.md#Intro', original: '[doc](../Docs/Read%20Me.md#Intro)', displayText: 'doc', subpath: '#Intro', syntax: 'markdown', source: '[doc](../Docs/Read%20Me.md#Intro)' },
      { link: 'Specs/Spec.md', original: '[text][spec]', displayText: 'text', reference: 'spec', syntax: 'reference', source: '[text][spec]' },
      { link: 'Plan#^block-1', original: '[[Plan#^block-1]]', displayText: 'Plan > ^block-1', subpath: '#^block-1', syntax: 'wikilink', source: '[[Plan#^block-1]]' },
      { link: 'Target.md', original: 'href="Target.md"', displayText: 'Target.md', syntax: 'html', source: 'href="Target.md"' },
    ]);
    expect(cache.embeds?.map(({ position, ...link }) => ({ ...link, source: at(note, position) }))).toEqual([
      { link: 'Sketch.canvas', original: '![[Sketch.canvas]]', displayText: 'Sketch.canvas', syntax: 'wikilink', source: '![[Sketch.canvas]]' },
    ]);
    expect(cache.links![0]!.position).toEqual({ start: { line: 6, col: 13, offset: 176 }, end: { line: 6, col: 23, offset: 186 } });
    expect(cache.referenceLinks?.map(({ position, ...definition }) => ({ ...definition, source: at(note, position) }))).toEqual([
      { id: 'spec', link: 'Specs/Spec.md', original: '[spec]: Specs/Spec.md', source: '[spec]: Specs/Spec.md' },
    ]);
  });

  it('excludes code, comments, math, escaped syntax, numeric tags and external URLs', () => {
    const found = JSON.stringify(cache);
    for (const excluded of ['Code', 'Hidden', 'Math', 'Escaped', 'Fenced', 'Display', '#code', '#hidden', '#math', '#esc', '#2026', '#fenced', 'example.com']) {
      expect(found.includes(`"link":"${excluded}`) || found.includes(`"tag":"${excluded}"`), excluded).toBe(false);
    }
    expect(cache.tags?.map(({ tag, position }) => [tag, at(note, position)])).toEqual([['#tag/one', '#tag/one']]);
    expect(allTags(cache)).toEqual(['#tag/one', '#work/plan']);
  });

  it('records frontmatter links by dotted key, frontmatter, its position and aliases', () => {
    expect(cache.frontmatterLinks).toEqual([
      { key: 'owner', link: 'People/Ada', original: '[[People/Ada|Ada]]', displayText: 'Ada', syntax: 'wikilink' },
      { key: 'related.0', link: 'Plan#Scope', original: '[[Plan#Scope]]', displayText: 'Plan > Scope', subpath: '#Scope', syntax: 'wikilink' },
      { key: 'related.1', link: 'diagram.png', original: '![[diagram.png]]', displayText: 'diagram.png', syntax: 'wikilink', embed: true },
    ]);
    expect(cache.frontmatter).toMatchObject({ aliases: ['Roadmap', 'Q4 goals'], tags: ['work/plan'] });
    expect(at(note, cache.frontmatterPosition!)).toBe(note.slice(0, note.indexOf('\n# Title')));
    expect(cache.aliases).toEqual(['Roadmap', 'Q4 goals']);
  });

  it('indexes headings, sections, block ids and list items with task status', () => {
    expect(cache.headings?.map(({ heading, level, position }) => [heading, level, at(note, position)])).toEqual([
      ['Title with [[Inline]]', 1, '# Title with [[Inline]]'], ['Tasks', 2, '## Tasks'],
    ]);
    expect(cache.sections?.map(item => [item.type, item.id ?? null, item.position.start.line])).toEqual([
      ['yaml', null, 0], ['heading', null, 6], ['paragraph', null, 8], ['definition', null, 11], ['definition', null, 12], ['heading', null, 14],
      ['list', null, 16], ['paragraph', 'para-1', 20], ['callout', 'quote-id', 22], ['paragraph', null, 25], ['code', null, 27], ['math', null, 30],
    ]);
    expect(Object.fromEntries(Object.entries(cache.blocks!).map(([key, block]) => [key, [block.id, at(note, block.position).split('\n')[0]]]))).toEqual({
      'para-1': ['para-1', 'Paragraph with block ^para-1'], 'quote-id': ['quote-id', '> [!note] Callout'], 'task-1': ['task-1', '- [ ] open task ^task-1'],
    });
    expect(cache.listItems?.map(({ parent, task, id, position }) => ({ parent, task, id, text: at(note, position) }))).toEqual([
      { parent: -16, task: ' ', id: 'task-1', text: '- [ ] open task ^task-1' },
      { parent: 16, task: 'x', id: undefined, text: '- [x] nested done' },
      { parent: -16, task: undefined, id: undefined, text: '- plain item' },
    ]);
  });

  it('keeps positions exact in BOM and CRLF notes and reports notes without frontmatter', () => {
    const text = '﻿---\r\ntitle: x\r\n---\r\nIntro\r\n\r\n- [[A]]\r\n- #b';
    const crlf = parse('Note.md', text);
    expect(at(text, crlf.frontmatterPosition!)).toBe('---\r\ntitle: x\r\n---');
    expect(crlf.links?.map(link => [at(text, link.position), link.position.start])).toEqual([['[[A]]', { line: 5, col: 2, offset: 32 }]]);
    expect(crlf.tags?.map(tag => at(text, tag.position))).toEqual(['#b']);
    expect(crlf.listItems?.map(item => item.parent)).toEqual([-5, -5]);
    const plain = parse('Plain.md', '- one\n  - two');
    expect(plain).toEqual({ sections: [expect.objectContaining({ type: 'list' })], listItems: [expect.objectContaining({ parent: 0 }), expect.objectContaining({ parent: 0 })] });
    expect(Object.is(plain.listItems![0]!.parent, 0)).toBe(true);
  });

  it('rejects invalid frontmatter through the document codec', () => {
    expect(() => parse('Bad.md', '---\nx: [\n---\n')).toThrow(expect.objectContaining({ code: 'INVALID_YAML' }));
  });
});

describe('Canvas metadata parsing', () => {
  it('records file nodes as links with node ids and subpaths, ignoring other node types', () => {
    const canvas = JSON.stringify({ nodes: [
      { id: 'a', type: 'file', file: 'Notes/Plan.md', subpath: '#Scope', x: 0, y: 0, width: 10, height: 10 },
      { id: 'b', type: 'text', text: '[[Not a link]]', x: 0, y: 0, width: 10, height: 10 },
      { id: 'c', type: 'file', file: 'Assets/diagram.png', x: 0, y: 0, width: 10, height: 10 },
      { id: 'd', type: 'link', url: 'https://example.com', x: 0, y: 0, width: 10, height: 10 },
    ], edges: [] });
    expect(parse('Board.canvas', canvas)).toEqual({ canvasLinks: [
      { node: 'a', link: 'Notes/Plan.md#Scope', original: 'Notes/Plan.md', displayText: 'Notes/Plan.md > Scope', subpath: '#Scope', syntax: 'canvas' },
      { node: 'c', link: 'Assets/diagram.png', original: 'Assets/diagram.png', displayText: 'Assets/diagram.png', syntax: 'canvas' },
    ] });
    expect(parser.indexes('Board.canvas') && parser.indexes('Note.MD') && !parser.indexes('View.base') && !parser.indexes('image.png')).toBe(true);
  });
});
