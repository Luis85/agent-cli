import { expect, it } from 'vitest';
import { isSafeNavigationUrl, type InteractionDefinition } from '../../src/domain/interaction.ts';
import type { UiDefinition } from '../../src/domain/ui.ts';
import { validateUiLibrary } from '../../src/domain/ui-library.ts';
import { componentInteractionIds } from '../../src/domain/ui-interactions.ts';
import { MarkdownUiDefinitions } from '../../src/infrastructure/ui-definitions.ts';

const component = (overrides: Partial<UiDefinition> = {}): UiDefinition => ({
  schemaVersion: 1, id: 'toggle', sourcePath: 'components/toggle.md', description: '# Toggle\n', props: {},
  state: { expanded: { type: 'boolean', default: false }, text: { type: 'string', default: '' } },
  root: { tag: 'button', attrs: { 'aria-expanded': '{{state.expanded}}' }, interactions: ['toggle-expanded'] }, ...overrides,
});
const interaction = (overrides: Partial<InteractionDefinition> = {}): InteractionDefinition => ({
  schemaVersion: 1, id: 'toggle-expanded', sourcePath: 'interactions/toggle-expanded.md', description: '# Toggle\n',
  event: 'click', actions: [{ type: 'toggle-state', state: 'expanded' }], ...overrides,
});

it('round trips typed state and attachments without adding defaults to old definitions', () => {
  const codec = new MarkdownUiDefinitions(), original = component();
  expect(codec.parse(codec.serialize(original), original.sourcePath)).toEqual(original);
  expect(() => validateUiLibrary([original], [interaction()])).not.toThrow();
  expect(() => codec.serialize(component({ state: { expanded: { type: 'boolean', default: 'false' } } }))).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
});

it('checks state bindings and interaction references inside projected child nodes', () => {
  const original = component({ root: { tag: 'div', children: [{ tag: 'button', interactions: ['toggle-expanded'] }, { tag: 'span', text: '{{state.text}}' }] } });
  expect(componentInteractionIds(original)).toEqual(['toggle-expanded']);
  expect(() => validateUiLibrary([original])).toThrow(expect.objectContaining({ code: 'UNKNOWN_INTERACTION' }));
  expect(() => validateUiLibrary([original], [interaction(), interaction()])).toThrow(expect.objectContaining({ code: 'DUPLICATE_INTERACTION' }));
  expect(() => validateUiLibrary([component({ root: { tag: 'div', text: '{{state.missing}}' } })])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
  expect(() => validateUiLibrary([component({ root: { tag: 'div', text: '{{state.expanded.toString()}}' } })])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
});

it('passes typed state into required child props while keeping prop and state names independent', () => {
  const child = component({ id: 'child', props: { expanded: { type: 'boolean', required: true } }, root: { tag: 'p', text: '{{expanded}} / {{state.expanded}}' } });
  const parent = component({ root: { component: 'child', props: { expanded: '{{state.expanded}}' } } });
  expect(() => validateUiLibrary([parent, child])).not.toThrow();
});

it.each([
  { type: 'toggle-state', state: 'text' },
  { type: 'set-state', state: 'missing', value: true },
  { type: 'set-state', state: 'expanded', value: 'false' },
  { type: 'set-state', state: 'expanded', value: '{{state.text}}' },
  { type: 'set-state', state: 'expanded', value: '{{optional}}' },
  { type: 'emit', event: 'click' },
  { type: 'emit', event: 'focusin' },
  { type: 'emit', event: 'focusout' },
  { type: 'emit', event: 'changed', detail: { expanded: '{{state.missing}}' } },
  { type: 'navigate', url: '{{state.expanded}}' },
  { type: 'navigate', url: 'javascript:alert(1)' },
] satisfies InteractionDefinition['actions'])('rejects invalid attached action %#', action => {
  const original = component({ props: { optional: { type: 'boolean' } } });
  expect(() => validateUiLibrary([original], [interaction({ actions: [action] })])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
});

it('validates native form value/checked sources against event, element, and state types', () => {
  const input = component({ root: { tag: 'input', interactions: ['toggle-expanded'] } });
  const readValue = interaction({ event: 'input', actions: [{ type: 'set-state', state: 'text', fromEvent: 'value' }] });
  expect(() => validateUiLibrary([input], [readValue])).not.toThrow();
  expect(() => validateUiLibrary([input], [interaction({ event: 'change', actions: [{ type: 'set-state', state: 'expanded', fromEvent: 'checked' }] })])).not.toThrow();
  for (const invalid of [interaction({ ...readValue, event: 'click' }), interaction({ event: 'input', actions: [{ type: 'set-state', state: 'expanded', fromEvent: 'value' }] })]) {
    expect(() => validateUiLibrary([input], [invalid])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
  }
  expect(() => validateUiLibrary([component()], [readValue])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
});

it('requires compatible form attachment and explicitly declared upload destinations', () => {
  const upload = interaction({ event: 'submit', actions: [{ type: 'upload-form', url: '{{uploadUrl}}' }] });
  const form = component({ props: { uploadUrl: { type: 'string', required: true } }, root: { tag: 'form', interactions: ['toggle-expanded'] } });
  expect(() => validateUiLibrary([form], [upload])).not.toThrow();
  expect(() => validateUiLibrary([{ ...form, props: {} }], [upload])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
  expect(() => validateUiLibrary([component()], [upload])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
  for (const action of [{ type: 'save-form', key: '{{state.expanded}}' }, { type: 'download-form', filename: '{{state.expanded}}' }] satisfies InteractionDefinition['actions']) {
    expect(() => validateUiLibrary([form], [interaction({ event: 'submit', actions: [action] })])).toThrow(expect.objectContaining({ code: 'INVALID_UI' }));
  }
});

it.each(['/settings', './next', '../back', '?tab=one', '#details', 'https://example.com/a', 'http://localhost:3000/'])('accepts safe navigation %s', url => {
  expect(isSafeNavigationUrl(url)).toBe(true);
});
it.each(['', '//example.com', 'javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com', '\\example.com', ' https://example.com', 'https://', '/a\n'])('rejects unsafe navigation %s', url => {
  expect(isSafeNavigationUrl(url)).toBe(false);
});
