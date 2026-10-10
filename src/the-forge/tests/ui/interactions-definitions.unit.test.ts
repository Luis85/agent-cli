import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { interactionTriggerEvents } from '../../src/plugins/ui/domain/interactions/definition.ts';
import { MarkdownInteractionDefinitions } from '../../src/plugins/ui/infrastructure/interactions/definitions.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';

const codec = new MarkdownInteractionDefinitions(new ObsidianDocuments());
const base = { schemaVersion: 1, id: 'toggle-expanded', event: 'click', actions: [{ type: 'toggle-state', state: 'expanded' }] };
const parse = (patch: Record<string, unknown> = {}) => codec.parse(new TextEncoder().encode(`---\n${stringify({ ...base, ...patch })}---\n# Interaction\n\nKeep **Markdown**, {{state.expanded}} and examples intact.\n`), 'interactions/toggle-expanded.md');

describe('Markdown interaction contract', () => {
  it('round-trips prose, event options and ordered scalar actions', () => {
    const definition = parse({ event: 'keydown', keys: ['Enter', ' '], preventDefault: true, stopPropagation: true, actions: [
      { type: 'set-state', state: 'title', value: 'Hello' }, { type: 'toggle-state', state: 'expanded' },
      { type: 'emit', event: 'dialog:changed', detail: { expanded: true, count: 1, label: 'hi', absent: null } },
      { type: 'navigate', url: '/next?view=expanded#details' },
    ] });
    expect(definition.description).toContain('**Markdown**, {{state.expanded}}');
    expect(definition.sourcePath).toBe('interactions/toggle-expanded.md');
    expect(codec.parse(codec.serialize(definition), definition.sourcePath)).toEqual(definition);
  });
  it.each([...interactionTriggerEvents])('rejects emitting native %s to prevent handler recursion', event => {
    expect(() => parse({ actions: [{ type: 'emit', event }] })).toThrow(expect.objectContaining({ code: 'INVALID_INTERACTION' }));
  });
  it.each(['input', 'change'])('accepts typed event inputs for %s', event => {
    const definition = parse({ event, actions: [{ type: 'set-state', state: 'value', fromEvent: 'value' }, { type: 'set-state', state: 'selected', fromEvent: 'checked' }] });
    expect(definition.actions).toHaveLength(2);
  });
  it('round trips bounded form workflows with configurable destinations', () => {
    const actions = [{ type: 'save-form', key: '{{draftKey}}' }, { type: 'upload-form', url: '{{uploadUrl}}' }, { type: 'download-form', filename: 'draft.json' }];
    const definition = parse({ event: 'submit', preventDefault: true, actions });
    expect(codec.parse(codec.serialize(definition), definition.sourcePath).actions).toEqual(actions);
  });
  it.each(['https://example.test/path', 'http://localhost:8080/', '/items/{{id}}', '?q={{state.search}}', '#details', 'relative/page', '{{destination}}'])('accepts safe navigation %s', url => {
    expect(parse({ actions: [{ type: 'navigate', url }] }).actions).toEqual([{ type: 'navigate', url }]);
  });
  it.each([
    { schemaVersion: 2 }, { unknown: true }, { id: '../outside' }, { event: 'mouseover' }, { event: 'onClick' },
    { preventDefault: 'true' }, { keys: ['Enter'] }, { event: 'keydown', keys: [] }, { event: 'keyup', keys: ['Enter', 'Enter'] },
    { actions: [] }, { actions: [{ type: 'execute', code: 'alert(1)' }] },
    { actions: [{ type: 'toggle-state', state: 'expanded', extra: true }] },
    { actions: [{ type: 'toggle-state', state: 'constructor' }] },
    { actions: [{ type: 'set-state', state: 'value' }] },
    { actions: [{ type: 'set-state', state: 'value', value: ['array'] }] },
    { actions: [{ type: 'set-state', state: 'value', value: '{{state..broken}}' }] },
    { actions: [{ type: 'emit', event: 'custom', detail: { label: '{{broken' } }] },
    { actions: [{ type: 'set-state', state: 'value', fromEvent: 'value' }] },
    { event: 'input', actions: [{ type: 'set-state', state: 'value', value: 'literal', fromEvent: 'value' }] },
    { event: 'change', actions: [{ type: 'set-state', state: 'value', fromEvent: 'target' }] },
    { actions: [{ type: 'emit', event: '', detail: {} }] },
    { actions: [{ type: 'emit', event: 'custom', detail: { nested: { value: true } } }] },
    { actions: [{ type: 'emit', event: 'custom', detail: { constructor: true } }] },
    { actions: [{ type: 'save-form', key: '' }] },
    { actions: [{ type: 'save-form', key: '   ' }] },
    { actions: [{ type: 'save-form', key: '{{broken' }] },
    { actions: [{ type: 'upload-form', url: 'javascript:alert(1)' }] },
    { actions: [{ type: 'upload-form', url: '/upload', method: 'DELETE' }] },
    { actions: [{ type: 'download-form', filename: '../draft.json' }] },
    { actions: [{ type: 'download-form', filename: '' }] },
    { actions: [{ type: 'download-form', filename: 'draft\n.json' }] },
    { event: 'input', actions: [{ type: 'save-form', key: 'draft' }] },
  ] as Record<string, unknown>[])('rejects invalid interaction contracts %#', patch => {
    expect(() => parse(patch)).toThrow(expect.objectContaining({ code: 'INVALID_INTERACTION' }));
  });
  it.each(['javascript:alert(1)', 'javascript:{{code}}', 'data:text/html,hello', 'vbscript:hello', '//example.test', 'https://user:secret@example.test', '\\example.test', 'java\nscript:alert(1)', '', ' /path', '/items/{{ broken', '/items/{{a.b.c}}'])('rejects unsafe or malformed navigation %s', url => {
    expect(() => parse({ actions: [{ type: 'navigate', url }] })).toThrow(expect.objectContaining({ code: 'INVALID_INTERACTION' }));
  });
  it.each(['No frontmatter', '---\nid: one\nid: two\n---\n', '---\nactions: &loop [*loop]\n---\n', '---\nactions: [\n---\n'])('rejects malformed or recursive YAML', text => {
    expect(() => codec.parse(new TextEncoder().encode(text), 'interactions/bad.md')).toThrow(expect.objectContaining({ code: 'INVALID_INTERACTION' }));
  });
  it('rejects invalid UTF-8 and noncontained source paths', () => {
    expect(() => codec.parse(new Uint8Array([255]), 'interactions/bad.md')).toThrow(expect.objectContaining({ code: 'INVALID_INTERACTION' }));
    expect(() => codec.parse(codec.serialize(parse()), '../outside.md')).toThrow(expect.objectContaining({ code: 'INVALID_PATH' }));
  });
});
