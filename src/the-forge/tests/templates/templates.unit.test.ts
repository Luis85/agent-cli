import { describe, expect, it } from 'vitest';
import { MarkdownTemplates } from '../../src/infrastructure/templates/markdown.ts';
import { ObsidianDocuments, encodeText } from '../../src/infrastructure/documents/codec.ts';

const templates = new MarkdownTemplates();
const documents = new ObsidianDocuments();
const options = { title: 'Work item', date: '2026-10-07T14:05:06Z' };
const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
const properties = (bytes: Uint8Array) => (documents.inspect('note.md', bytes) as { properties: unknown }).properties;

describe('Obsidian Markdown templates', () => {
  it('renders authored frontmatter and Markdown without rewriting the body syntax', () => {
    const source = '---\n# Keep my schema comment\ntitle: "{{title}}"\ncreated: {{date}}\ntags: {{tags}}\n---\n# {{title}}\n\n![[Sketch.canvas]]\n> [!tip]\n> {{summary}}\n\n```ts\nconst answer = 42;\n```\n';
    const output = templates.render(encodeText(source), { ...options, values: { tags: ['task', 'engineering'], summary: 'Write acceptance criteria' } });
    expect(properties(output)).toEqual({ title: 'Work item', created: '2026-10-07', tags: ['task', 'engineering'] });
    expect(text(output)).toContain('# Keep my schema comment');
    expect(text(output)).toContain('# Work item\n\n![[Sketch.canvas]]\n> [!tip]\n> Write acceptance criteria\n\n```ts\nconst answer = 42;\n```\n');
  });

  it('preserves JSON types for whole placeholders, including quoted YAML placeholders', () => {
    const source = '---\ncount: "{{count}}"\ndone: {{done}}\nparent: {{parent}}\nmetadata: {{metadata}}\nitems: ["{{count}}", "{{done}}"]\nlabel: "Item {{count}} ({{done}})"\n---\n{{metadata}}';
    const output = templates.render(encodeText(source), { ...options, values: { count: 0, done: false, parent: null, metadata: { owner: 'Ada', tags: ['work'] } } });
    expect(properties(output)).toEqual({ count: 0, done: false, parent: null, metadata: { owner: 'Ada', tags: ['work'] }, items: [0, false], label: 'Item 0 (false)' });
    expect(text(output)).toContain('{"owner":"Ada","tags":["work"]}');
  });

  it('serializes malicious-looking YAML values without injecting keys or closing frontmatter', () => {
    const attack = 'hello\nadmin: true\n---\n# Unexpected body';
    const output = templates.render(encodeText('---\ntitle: {{title}}\nmessage: {{message}}\nprefix: "Text: {{message}}"\n---\n# Original body\n'), { ...options, title: attack, values: { message: attack } });
    expect(properties(output)).toEqual({ title: attack, message: attack, prefix: `Text: ${attack}` });
    expect(documents.inspect('note.md', output)).toMatchObject({ body: '# Original body\n' });
  });

  it('substitutes once, without evaluating placeholders supplied as values', () => {
    const output = templates.render(encodeText('---\nlabel: {{label}}\n---\n{{label}}'), { ...options, values: { label: '{{missing}}' } });
    expect(properties(output)).toEqual({ label: '{{missing}}' });
    expect(text(output).endsWith('{{missing}}')).toBe(true);
  });

  it('preserves values resembling internal interpolation tokens', () => {
    const value = { content: 'AGENTCLITEMPLATETOKEN0END', nested: ['AGENTCLITEMPLATETOKENX0END'] };
    const output = templates.render(encodeText('---\nvalue: {{value}}\n---\n'), { ...options, values: { value } });
    expect(properties(output)).toEqual({ value });
  });

  it('retains BOM, CRLF, and Markdown whitespace', () => {
    const output = templates.render(encodeText('\uFEFF---\r\ntitle: {{title}}\r\n---\r\n# {{title}}  \r\n\r\n[[Other Note|alias]]\r\n'), options);
    expect(text(output).startsWith('\uFEFF---\r\n')).toBe(true);
    expect(text(output)).not.toMatch(/(?<!\r)\n/);
    expect(text(output).endsWith('# Work item  \r\n\r\n[[Other Note|alias]]\r\n')).toBe(true);
  });

  it('supports Obsidian-style date and time formats with deterministic UTC output', () => {
    const output = templates.render(encodeText('{{date}} {{time}} | {{date:dddd, MMMM Do YYYY}} | {{time:HH:mm:ss}}'), { ...options, date: '2026-10-07T16:05:06+02:00' });
    expect(text(output)).toBe('2026-10-07 14:05 | Wednesday, October 7th 2026 | 14:05:06');
    expect(text(templates.render(encodeText('{{date}} {{time}}'), { ...options, dateFormat: 'YYYY/MM/DD', timeFormat: 'HH-mm' }))).toBe('2026/10/07 14-05');
    expect(text(templates.render(encodeText('{{date}}'), { ...options, date: '2024-02-29' }))).toBe('2024-02-29');
  });

  it('lists unique variables for discovery without requiring values', () => {
    const bytes = encodeText('---\ntitle: {{title}}\ntags: {{tags}}\n---\n{{title}} {{owner}} {{date:YYYY}}');
    expect(templates.inspect(bytes)).toEqual({ variables: ['date:YYYY', 'owner', 'tags', 'title'], requiredVariables: ['owner', 'tags'], builtins: ['date:YYYY', 'title'] });
  });
  it('distinguishes caller inputs from every date/time expression and deduplicates keys', () => {
    expect(templates.inspect(encodeText('{{owner}} {{title}} {{date}} {{date:YYYY}} {{time}} {{time:HH:mm}} {{owner}}'))).toEqual({
      variables: ['date', 'date:YYYY', 'owner', 'time', 'time:HH:mm', 'title'], requiredVariables: ['owner'], builtins: ['date', 'date:YYYY', 'time', 'time:HH:mm', 'title'],
    });
    expect(templates.inspect(encodeText('No inputs'))).toEqual({ variables: [], requiredVariables: [], builtins: [] });
  });

  it.each(['{{missing}}', '---\nkey: {{missing}}\n---\n'])('reports missing variables in body or YAML', source => {
    expect(() => templates.render(encodeText(source), options)).toThrow(expect.objectContaining({ code: 'UNKNOWN_TEMPLATE_VARIABLE' }));
  });

  it.each(['{{', '}}', '{{}}', '{{title}', '{{one {{two}}', '{{user:format}}', '{{title}}}}'])('rejects malformed placeholder %s', source => {
    expect(() => templates.render(encodeText(source), options)).toThrow(expect.objectContaining({ code: 'INVALID_TEMPLATE' }));
  });

  it.each([
    '---\n{{title}}: value\n---\n',
    '---\n# {{title}}\nkey: value\n---\n',
    '---\nvalue: &{{title}} hello\n---\n',
    '---\n- item\n---\n',
    '---\nkey: [\n---\n',
    '---\nkey: first\nkey: second\n---\n',
    '---\nloop: &loop [*loop]\n---\n',
    '---\nvalue: .nan\n---\n',
    '---\n? [one, two]\n: value\n---\n',
  ])('rejects unsafe or malformed template YAML', source => {
    expect(() => templates.render(encodeText(source), options)).toThrow(expect.objectContaining({ code: 'INVALID_TEMPLATE' }));
  });

  it('rejects unclosed frontmatter, invalid UTF-8, and reserved overrides', () => {
    expect(() => templates.render(encodeText('---\ntitle: test\n'), options)).toThrow(expect.objectContaining({ code: 'INVALID_FRONTMATTER' }));
    expect(() => templates.render(new Uint8Array([0xff]), options)).toThrow(expect.objectContaining({ code: 'INVALID_ENCODING' }));
    for (const key of ['title', 'date', 'time']) expect(() => templates.render(encodeText('{{title}}'), { ...options, values: { [key]: 'override' } })).toThrow(expect.objectContaining({ code: 'INVALID_TEMPLATE_VALUES' }));
  });

  it.each(['2025-02-29', '2026-13-01', '2026-00-01', '2026-10-07T25:00:00Z', '2026-10-07T12:00:00', 'tomorrow'])('rejects invalid or ambiguous date %s', date => {
    expect(() => templates.render(encodeText('{{date}}'), { ...options, date })).toThrow(expect.objectContaining({ code: 'INVALID_TEMPLATE_DATE' }));
  });

  it('rejects values that JSON cannot represent faithfully', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [undefined, NaN, Infinity, new Date(), cycle]) expect(() => templates.render(encodeText('{{value}}'), { ...options, values: { value } })).toThrow(expect.objectContaining({ code: 'INVALID_TEMPLATE_VALUES' }));
  });

  it('supports YAML aliases and substitutes anchored values safely', () => {
    const output = templates.render(encodeText('---\nfirst: &owner {{owner}}\nsecond: *owner\n---\n'), { ...options, values: { owner: { name: 'Ada' } } });
    expect(properties(output)).toEqual({ first: { name: 'Ada' }, second: { name: 'Ada' } });
  });
});
