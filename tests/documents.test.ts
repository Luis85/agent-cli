import { describe, expect, it } from 'vitest';
import { ObsidianDocuments, encodeText } from '../src/infrastructure/documents.ts';
import { validateCanvas } from '../src/domain/canvas.ts';
const codec = new ObsidianDocuments();
const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
const node = { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 100, text: 'Hello' };

describe('Obsidian documents', () => {
  it('preserves Markdown syntax, comments, CRLF and body during property edits', () => {
    const body = '# Heading\r\n![[asset.png|200]]\r\n> [!tip]\r\n$$x^2$$\r\n```ts\r\nconst x = 1;\r\n```\r\n';
    const input = `---\r\n# retain me\r\ntags: [one, two]\r\nstatus: draft\r\n---\r\n${body}`;
    const output = decode(codec.properties(encodeText(input), { status: 'done', checked: false, count: 0 }));
    expect(output).toContain('# retain me');
    expect(output.endsWith(body)).toBe(true);
    expect(codec.inspect('note.md', encodeText(output))).toMatchObject({ properties: { status: 'done', checked: false, count: 0, tags: ['one', 'two'] } });
  });
  it('creates frontmatter without disturbing a plain note', () => {
    expect(decode(codec.properties(encodeText('# Hello\n'), { tags: ['project'] }))).toMatch(/---\n[\s\S]*---\n# Hello\n$/);
  });
  it('retains a UTF-8 BOM and permits empty commented frontmatter', () => {
    const input = '\uFEFF---\n# Comment\n---\n# Body\n';
    const output = decode(codec.properties(encodeText(input), { status: 'draft' }));
    expect(output.startsWith('\uFEFF---')).toBe(true);
    expect(output).toContain('# Comment');
    expect(output.endsWith('# Body\n')).toBe(true);
  });
  it.each(['---\nfoo: [\n---\n', '---\nfoo: 1\nfoo: 2\n---\n', '---\nfoo: 1\n', '---\n- item\n---\n'])('rejects malformed frontmatter %s', input => {
    expect(() => codec.validate('note.md', encodeText(input))).toThrow();
  });
  it('accepts all Canvas node types, optional arrays and extension keys', () => {
    expect(() => validateCanvas({})).not.toThrow();
    validateCanvas({ nodes: [node, { ...node, id: 'b', type: 'file', file: 'note.md' }, { ...node, id: 'c', type: 'link', url: 'https://example.com' }, { ...node, id: 'd', type: 'group', label: 'Group' }], edges: [{ id: 'edge', fromNode: 'a', toNode: 'b' }], custom: true });
  });
  it.each([
    { nodes: [node, node] },
    { nodes: [{ ...node, width: -1 }] },
    { nodes: [{ ...node, type: 'mystery' }] },
    { nodes: [node], edges: [{ id: 'edge', fromNode: 'a', toNode: 'missing' }] },
    { nodes: [node], edges: [{ id: 'edge', fromNode: 'a', toNode: 'a', fromSide: 'middle' }] },
  ])('rejects invalid Canvas graphs', data => expect(() => validateCanvas(data)).toThrow());
  it('patches Canvas while retaining unknown fields and validates the new graph', () => {
    const bytes = encodeText(JSON.stringify({ nodes: [node], edges: [], extension: { a: 1 } }));
    const result = codec.patch('map.canvas', bytes, '/nodes/0/text', 'Updated');
    expect(JSON.parse(decode(result))).toMatchObject({ nodes: [{ text: 'Updated' }], extension: { a: 1 } });
    expect(() => codec.patch('map.canvas', bytes, '/nodes/0/width', -1)).toThrow();
    expect(() => codec.patch('map.canvas', bytes, '/__proto__/polluted', true)).toThrow();
    expect(() => codec.patch('map.canvas', bytes, '/nodes/01/text', 'bad')).toThrow();
  });
  it('round trips Bases expressions and comments without evaluating them', () => {
    const text = '# retain comment\nfilters:\n  and:\n    - file.hasTag("task")\nformulas:\n  price: price * 2\nviews:\n  - type: table\n    name: Tasks\n    custom: true\n';
    const result = decode(codec.patch('tasks.base', encodeText(text), '/views/0/name', 'Work'));
    expect(result).toContain('# retain comment'); expect(result).toContain('price * 2'); expect(result).toContain('custom: true');
    expect(codec.inspect('tasks.base', encodeText(result))).toMatchObject({ data: { views: [{ name: 'Work' }] } });
  });
  it('appends Base views using JSON Pointer and rejects malformed structures', () => {
    const result = codec.patch('tasks.base', encodeText('views: []\n'), '/views/-', { type: 'table', name: 'Tasks' });
    expect(codec.inspect('tasks.base', result)).toMatchObject({ data: { views: [{ name: 'Tasks' }] } });
    expect(() => codec.validate('tasks.base', encodeText('views: nope'))).toThrow();
    expect(() => codec.validate('tasks.base', encodeText('filters: {wrong: []}'))).toThrow();
    expect(() => codec.validate('tasks.base', encodeText('formulas: {price: 2}'))).toThrow();
    expect(() => codec.validate('tasks.base', encodeText('views: [{type: table, name: Table, filters: 42}]'))).toThrow();
  });
});
