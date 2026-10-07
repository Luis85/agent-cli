import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { validateUiLibrary } from '../../src/application/ui.ts';
import { encodeText } from '../../src/infrastructure/documents.ts';
import { MarkdownUiDefinitions } from '../../src/infrastructure/ui-definitions.ts';
import { standardUiCatalog } from '../../src/infrastructure/ui-catalog.ts';

const codec = new MarkdownUiDefinitions();
const source = (id: string, fields: Record<string, unknown> = {}, body = '# Description\n\nKeep **Markdown** and {{prose}} intact.\n') => encodeText(`---\n${stringify({ schemaVersion: 1, id, root: { tag: 'div', children: [{ slot: 'children' }] }, ...fields })}---\n${body}`);
const definition = (id: string, fields: Record<string, unknown> = {}) => codec.parse(source(id, fields), `library/${id}.md`);

describe('strict Markdown UI definitions', () => {
  it('retains Markdown description and serializes typed defaults and native metadata', () => {
    const original = definition('notice', { props: { count: { type: 'number', default: 3 }, enabled: { type: 'boolean', default: false } }, storybook: { tags: ['autodocs'], parameters: { viewport: { defaultViewport: 'mobile1' } }, extension: 'stories/notice.mjs', stories: [{ name: 'Active', args: { enabled: true } }] } });
    expect(codec.parse(codec.serialize(original), original.sourcePath)).toEqual(original);
    expect(original.description).toContain('**Markdown** and {{prose}}');
  });
  it.each([
    { schemaVersion: 2 }, { unknown: true }, { id: '../outside' }, { root: { tag: 'div', typo: true } },
    { props: { count: { type: 'number', default: '3' } } }, { props: { class: { type: 'string' } } },
    { props: { children: { type: 'string' } } }, { props: { undefined: { type: 'string' } } }, { props: { title: { type: 'array' } } },
    { root: { tag: 'div', attrs: { onclick: 'alert(1)' } } }, { root: { tag: 'img', children: [{ slot: 'children' }] } },
    { name: 'Bad Name' }, { name: 'X;alert(1)' }, { root: { tag: 'input', attrs: { 'bind:value': '{{value}}' } } },
    { root: { tag: 'div', attrs: { 'v-if': 'hidden' } } },
    { storybook: { extension: '../escape.js' } }, { storybook: { stories: [{ name: 'Default' }, { name: 'Default' }] } },
  ])('rejects unsupported or ambiguous definition %#', fields => {
    expect(() => definition('example', fields)).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
  });
  it.each(['No frontmatter', '---\nid: one\nid: two\n---\n', '---\nroot: &loop {children: [*loop]}\n---\n', '---\nschemaVersion: 1\nid: widget\nroot: {tag: div}\nextra: .nan\n---\n', '---\nroot: [\n---\n'])('rejects malformed YAML and unsupported structures', text => {
    expect(() => codec.parse(encodeText(text), 'library/bad.md')).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
  });
  it('validates every built-in definition and its complete graph', () => {
    expect(standardUiCatalog.length).toBeGreaterThanOrEqual(50);
    const definitions = standardUiCatalog.map(item => codec.parse(codec.serialize(item), item.sourcePath));
    expect(() => validateUiLibrary(definitions)).not.toThrow();
    expect(definitions.map(item => item.id)).toEqual(definitions.map(item => item.id).sort());
  });
  it.each(['svg', 'math'])('rejects namespace-specific %s trees before generation', tag => {
    expect(() => definition('graphic', { root: { tag: 'div', children: [{ tag }] } })).toThrow(/SVG and MathML namespaces are unsupported/);
  });
  it('rejects duplicate ids, missing references, cycles and binding mismatches', () => {
    expect(() => validateUiLibrary([definition('one'), definition('one')])).toThrow(expect.objectContaining({ code: 'DUPLICATE_UI_COMPONENT' }));
    expect(() => validateUiLibrary([definition('one', { root: { component: 'missing' } })])).toThrow(expect.objectContaining({ code: 'UNKNOWN_UI_COMPONENT' }));
    expect(() => validateUiLibrary([definition('one', { root: { component: 'two' } }), definition('two', { root: { component: 'one' } })])).toThrow(expect.objectContaining({ code: 'CYCLIC_UI_COMPONENT' }));
    const child = definition('child', { props: { count: { type: 'number', required: true } } });
    for (const props of [{}, { count: 'wrong' }, { unknown: 2 }, { count: '{{missing}}' }]) expect(() => validateUiLibrary([child, definition('parent', { root: { component: 'child', props } })])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
    expect(() => validateUiLibrary([definition('bad', { root: { tag: 'p', text: '{{missing}}' } })])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
    expect(() => validateUiLibrary([definition('bad', { root: { tag: 'p', text: '{{broken' } })])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
    expect(() => validateUiLibrary([child, definition('parent', { props: { count: { type: 'number' } }, root: { component: 'child', props: { count: '{{count}}' } } })])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
    expect(() => validateUiLibrary([definition('bad', { storybook: { args: { missing: 'value' } } })])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
  });
  it('allows nested composition, matching typed bindings, named stories and children', () => {
    const child = definition('child', { props: { count: { type: 'number', required: true } }, root: { tag: 'p', text: '{{count}}', children: [{ slot: 'children' }] } });
    const parent = definition('parent', { props: { total: { type: 'number', default: 1 } }, root: { tag: 'section', children: [{ component: 'child', props: { count: '{{total}}' }, children: [{ tag: 'strong', text: 'items' }] }] }, storybook: { stories: [{ name: 'Many', args: { total: 9 } }] } });
    expect(() => validateUiLibrary([child, parent])).not.toThrow();
  });
  it('rejects multiple explicit child slots, including slots nested through reference children', () => {
    const repeated = definition('repeated', { root: { tag: 'div', children: [{ slot: 'children' }, { slot: 'children' }] } });
    expect(() => validateUiLibrary([repeated])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
    const child = definition('child');
    const parent = definition('parent', { root: { tag: 'div', children: [{ slot: 'children' }, { component: 'child', children: [{ slot: 'children' }] }] } });
    expect(() => validateUiLibrary([child, parent])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
  });
});
