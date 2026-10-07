import { describe, expect, it } from 'vitest';
import { ObsidianDocuments, encodeText, parseMarkdownParts } from '../../src/the-forge/infrastructure/documents/codec.ts';
import { validateCanvas } from '../../src/the-forge/domain/documents/canvas.ts';
const codec = new ObsidianDocuments();
const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
const node = { id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 100, text: 'Hello' };

describe('Obsidian documents', () => {
  it.each(['\n', '\r\n', '\r'])('uses Markdown AST boundaries without rewriting source for %j line endings', newline => {
    const yaml = `# Keep this${newline}description: |${newline}  ---${newline}  Inside a scalar${newline}`;
    const body = `${newline}# Body${newline}---${newline}[[Plan#Heading|Label]]${newline}`;
    const result = parseMarkdownParts(`\uFEFF---  ${newline}${yaml}---  ${newline}${body}`);
    expect(result).toEqual({ prefix: '\uFEFF', exists: true, newline, yaml, body });
  });
  it('does not interpret frontmatter inside a Markdown code fence', () => {
    const body = '# Example\n```yaml\n---\nnot: frontmatter\n---\n```\n';
    expect(parseMarkdownParts(body)).toMatchObject({ exists: false, yaml: '', body });
  });
  it('accepts empty frontmatter ending at EOF', () => {
    expect(parseMarkdownParts('---\n---')).toMatchObject({ exists: true, yaml: '', body: '' });
  });
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
  it('uses the original newline style when adding frontmatter to a BOM-prefixed note', () => {
    const output = decode(codec.properties(encodeText('\uFEFF# Hello\r\nBody\r\n'), { status: 'draft' }));
    expect(output.startsWith('\uFEFF---\r\n')).toBe(true);
    expect(output).not.toMatch(/(?<!\r)\n/);
    expect(codec.inspect('note.md', encodeText(output))).toMatchObject({ properties: { status: 'draft' }, body: '# Hello\r\nBody\r\n' });
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
  it.each(['loop: &loop [*loop]', 'loop: &loop {self: *loop}', 'number: .nan', 'number: .inf', '? [a, b]\n: value', 'value: *missing', 'binary: !!binary YQ=='])('rejects YAML that cannot be represented faithfully in JSON: %s', yaml => {
    for (const [path, content] of [['note.md', `---\n${yaml}\n---\nBody\n`], ['tasks.base', yaml]]) {
      expect(() => codec.inspect(path!, encodeText(content!))).toThrow(expect.objectContaining({ code: 'INVALID_YAML' }));
    }
    expect(() => codec.properties(encodeText(`---\n${yaml}\n---\nBody\n`), { status: 'draft' })).toThrow(expect.objectContaining({ code: 'INVALID_YAML' }));
  });
  it('accepts repeated noncyclic YAML aliases as JSON-compatible data', () => {
    const input = encodeText('---\ntags: &tags [one, two]\nrelated: *tags\n---\nBody\n');
    const result = codec.inspect('note.md', codec.properties(input, { status: 'draft' }));
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({ properties: { tags: ['one', 'two'], related: ['one', 'two'], status: 'draft' } });
  });
  it('returns structured errors for invalid UTF-8 and malformed Canvas JSON', () => {
    expect(() => codec.inspect('note.md', new Uint8Array([0xff]))).toThrow(expect.objectContaining({ code: 'INVALID_ENCODING' }));
    expect(() => codec.inspect('map.canvas', encodeText('{'))).toThrow(expect.objectContaining({ code: 'INVALID_CANVAS' }));
    expect(() => codec.inspect('map.canvas', encodeText('{"extension":1e400}'))).toThrow(expect.objectContaining({ code: 'INVALID_CANVAS' }));
  });
  it('accepts all Canvas node types, optional arrays and extension keys', () => {
    expect(() => validateCanvas({})).not.toThrow();
    validateCanvas({ nodes: [node, { ...node, id: 'b', type: 'file', file: 'note.md' }, { ...node, id: 'c', type: 'link', url: 'https://example.com' }, { ...node, id: 'd', type: 'group', label: 'Group' }], edges: [{ id: 'edge', fromNode: 'a', toNode: 'b' }], custom: true });
  });
  it('accepts Canvas file anchors and preserves them through pointer edits', () => {
    for (const subpath of ['#Heading', '#^block-id']) {
      const bytes = encodeText(JSON.stringify({ nodes: [{ ...node, type: 'file', file: 'note.md', subpath }] }));
      const result = codec.patch('map.canvas', bytes, '/nodes/0/x', 20);
      expect(codec.inspect('map.canvas', result)).toMatchObject({ data: { nodes: [{ subpath, x: 20 }] } });
    }
  });
  it.each(['Heading', '', '^block-id'])('rejects Canvas file subpaths without a # prefix: %j', subpath => {
    const bytes = encodeText(JSON.stringify({ nodes: [{ ...node, type: 'file', file: 'note.md', subpath }] }));
    expect(() => codec.validate('map.canvas', bytes)).toThrow(expect.objectContaining({ code: 'INVALID_CANVAS' }));
    expect(() => codec.patch('map.canvas', encodeText(JSON.stringify({ nodes: [{ ...node, type: 'file', file: 'note.md' }] })), '/nodes/0/subpath', subpath)).toThrow(expect.objectContaining({ code: 'INVALID_CANVAS' }));
  });
  it.each([
    { nodes: [node, node] },
    { nodes: [{ ...node, width: -1 }] },
    { nodes: [{ ...node, type: 'mystery' }] },
    { nodes: [node], edges: [{ id: 'edge', fromNode: 'a', toNode: 'missing' }] },
    { nodes: [node], edges: [{ id: 'edge', fromNode: 'a', toNode: 'a', fromSide: 'middle' }] },
    { nodes: null },
    { edges: null },
    { nodes: [{ ...node, type: ['text'] }] },
    { nodes: [{ ...node, backgroundStyle: ['cover'] }] },
    { nodes: [{ ...node, id: '1' }], edges: [{ id: 'edge', fromNode: 1, toNode: '1' }] },
    { nodes: [node], edges: [{ id: 'edge', fromNode: ['a'], toNode: 'a' }] },
    { nodes: [node], edges: [{ id: 'edge', fromNode: 'a', toNode: 'a', fromSide: ['top'] }] },
    { nodes: [node], edges: [{ id: 'edge', fromNode: 'a', toNode: 'a', toEnd: ['arrow'] }] },
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
  it.each([
    ['map.canvas', '{\r\n  "nodes": [],\r\n  "edges": [],\r\n  "extension": "old"\r\n}\r\n', '/extension'],
    ['tasks.base', '# retain comment\r\nviews: []\r\nextension: old\r\n', '/extension'],
  ])('preserves BOM and CRLF while patching %s', (path, text, pointer) => {
    const output = decode(codec.patch(path, encodeText('\uFEFF' + text), pointer, 'new'));
    expect(output.startsWith('\uFEFF')).toBe(true);
    expect(output).not.toMatch(/(?<!\r)\n/);
    expect(codec.inspect(path, encodeText(output))).toMatchObject({ data: { extension: 'new' } });
  });
  it('handles escaped pointer segments and explicitly rejects traversing YAML aliases', () => {
    const bytes = encodeText('views: []\ncustom: &custom {a/b: {"~name": old}}\nlinked: *custom\n');
    expect(() => codec.patch('tasks.base', bytes, '/linked/a~1b/~0name', 'new')).toThrow(expect.objectContaining({ code: 'INVALID_POINTER' }));
    const output = codec.patch('tasks.base', bytes, '/custom/a~1b/~0name', 'new');
    expect(codec.inspect('tasks.base', output)).toMatchObject({ data: { custom: { 'a/b': { '~name': 'new' } }, linked: { 'a/b': { '~name': 'new' } } } });
    expect(codec.inspect('tasks.base', codec.patch('tasks.base', bytes, '/linked', { independent: true }))).toMatchObject({ data: { linked: { independent: true } } });
  });
  it('rejects non-JSON edit values before serialization can discard them', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [NaN, undefined, cycle]) {
      expect(() => codec.patch('map.canvas', encodeText('{}'), '/extension', value)).toThrow(expect.objectContaining({ code: 'INVALID_CANVAS' }));
      expect(() => codec.properties(encodeText('# Note\n'), { value })).toThrow(expect.objectContaining({ code: 'INVALID_FRONTMATTER' }));
    }
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
