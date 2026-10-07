import { afterEach, expect, it } from 'vitest';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import type { UiDefinition } from '../../src/domain/ui.ts';
import type { InteractionDefinition } from '../../src/domain/interaction.ts';
import { renderUiComponents } from '../../src/infrastructure/ui-renderers.ts';

const windows: JSDOM[] = [];
afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });
const interaction = (id: string, event: InteractionDefinition['event'], actions: InteractionDefinition['actions']): InteractionDefinition => ({
  schemaVersion: 1, id, event, actions, description: id, sourcePath: `interactions/${id}.md`,
});
const interactions: InteractionDefinition[] = [
  interaction('change-title', 'input', [{ type: 'set-state', state: 'title', fromEvent: 'value' }]),
  interaction('toggle-expanded', 'click', [{ type: 'toggle-state', state: 'expanded' }]),
  interaction('set-checked', 'change', [{ type: 'set-state', state: 'checked', fromEvent: 'checked' }]),
  { ...interaction('reset-title', 'click', [{ type: 'set-state', state: 'title', value: 'Reset' }, { type: 'emit', event: 'title-changed', detail: { title: '{{state.title}}' } }]), preventDefault: true },
];
const definitions: UiDefinition[] = [
  {
    schemaVersion: 1, id: 'plain-label', description: 'A noninteractive child.', sourcePath: 'components/plain-label.md',
    props: { label: { type: 'string', default: 'Default' } }, root: { tag: 'span', attrs: { 'data-label': true }, text: '{{label}}' },
  },
  {
    schemaVersion: 1, id: 'live-panel', description: 'A stateful projected panel.', sourcePath: 'components/live-panel.md',
    props: { title: { type: 'string', default: 'Panel' } }, state: { expanded: { type: 'boolean', default: false } },
    root: { tag: 'section', attrs: { 'aria-label': '{{title}}' }, children: [
      { tag: 'h2', text: '{{title}}' },
      { tag: 'button', attrs: { 'data-toggle': true, 'aria-expanded': '{{state.expanded}}' }, text: 'Expanded: {{state.expanded}}', interactions: ['toggle-expanded'] },
      { slot: 'children' },
    ] },
  },
  {
    schemaVersion: 1, id: 'live-page', description: 'Root reference and projected live bindings.', sourcePath: 'components/live-page.md', props: {},
    state: { title: { type: 'string', default: 'Initial' }, checked: { type: 'boolean', default: false } },
    root: { component: 'live-panel', props: { title: '{{state.title}}' }, children: [
      { tag: 'input', attrs: { 'data-title': true, value: '{{state.title}}' }, interactions: ['change-title'] },
      { tag: 'input', attrs: { type: 'checkbox', checked: '{{state.checked}}' }, interactions: ['set-checked'] },
      { tag: 'output', text: 'Checked: {{state.checked}}' },
      { tag: 'button', attrs: { 'data-reset': true }, text: 'Reset', interactions: ['reset-title'] },
      { component: 'plain-label', props: { label: '{{state.title}}' } },
      { slot: 'children' },
    ] },
  },
];

function factory(framework: 'html' | 'htmx' | 'vanilla', input = definitions, handlers = interactions, id = 'live-page') {
  const dom = new JSDOM('', { url: 'https://example.test/start' }); windows.push(dom);
  const files = renderUiComponents(input, framework, 'generated', handlers);
  const modules = new Map<string, { exports: { default?: (props?: object, children?: Node[]) => HTMLElement | DocumentFragment } }>();
  function load(name: string) {
    const previous = modules.get(name);
    if (previous) return previous.exports;
    const file = files.find(candidate => candidate.path === `generated/${name}.js`)!;
    const source = new TextDecoder().decode(file.bytes);
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} }; modules.set(name, module);
    new Function('require', 'module', 'exports', 'document', code)(
      (specifier: string) => load(specifier.slice(2, -3)), module, module.exports, dom.window.document,
    );
    return modules.get(name)!.exports;
  }
  return { dom, create: load(id).default!, files };
}

it.each(['html', 'htmx', 'vanilla'] as const)('updates %s state while retaining roots, focused inputs, child state and projected nodes', framework => {
  const { dom, create, files } = factory(framework);
  const document = dom.window.document;
  const projected = document.createElement('strong'); projected.textContent = 'Projected';
  let projectedClicks = 0; projected.addEventListener('click', () => projectedClicks++);
  const root = create({}, [projected]) as HTMLElement; document.body.append(root);
  const title = root.querySelector<HTMLInputElement>('[data-title]')!;
  const label = root.querySelector('[data-label]')!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-toggle]')!;
  toggle.click(); expect(toggle.textContent).toBe('Expanded: true');
  title.focus(); title.value = '<script>Literal & safe</script>'; title.setSelectionRange(4, 7);
  title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  expect(document.body.firstElementChild).toBe(root);
  expect(document.activeElement).toBe(title);
  expect([title.selectionStart, title.selectionEnd]).toEqual([4, 7]);
  expect(root.querySelector('h2')?.textContent).toBe(title.value);
  expect(label.textContent).toBe(title.value);
  expect(root.querySelector('[data-label]')).toBe(label);
  expect(root.querySelector('[data-toggle]')).toBe(toggle);
  expect(toggle.textContent).toBe('Expanded: true');
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('strong')).toBe(projected);
  projected.click(); expect(projectedClicks).toBe(1);
  expect(new TextDecoder().decode(files.find(file => file.path === 'generated/live-page.html')!.bytes)).toContain('<h2>Initial</h2>');
});

it.each(['html', 'htmx', 'vanilla'] as const)('executes %s checked state, modifiers and ordered emitted details', framework => {
  const { dom, create } = factory(framework);
  const root = create() as HTMLElement; dom.window.document.body.append(root);
  const checkbox = root.querySelector<HTMLInputElement>('[type=checkbox]')!;
  checkbox.checked = true; checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  expect(root.querySelector('output')?.textContent).toBe('Checked: true');
  const received: unknown[] = [];
  root.addEventListener('title-changed', event => received.push((event as CustomEvent).detail));
  const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  root.querySelector('[data-reset]')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(received).toEqual([{ title: 'Reset' }]);
  expect(root.querySelector('h2')?.textContent).toBe('Reset');
  expect(root.querySelector<HTMLInputElement>('[data-title]')!.value).toBe('Reset');
});

it.each(['html', 'htmx', 'vanilla'] as const)('keeps %s slot-root component bindings live after its fragment is mounted', framework => {
  const passthrough: UiDefinition = { schemaVersion: 1, id: 'pass-through', description: 'Slot root.', sourcePath: 'pass-through.md', props: {}, root: { slot: 'children' } };
  const page: UiDefinition = {
    schemaVersion: 1, id: 'fragment-page', description: 'Live fragment.', sourcePath: 'fragment-page.md', props: {}, state: { title: { type: 'string', default: 'Before' } },
    root: { component: 'pass-through', children: [{ tag: 'button', text: '{{state.title}}', interactions: ['reset-title'] }] },
  };
  const { dom, create } = factory(framework, [passthrough, page], interactions, page.id);
  const fragment = create(); dom.window.document.body.append(fragment);
  const button = dom.window.document.querySelector('button')!; button.click();
  expect(dom.window.document.querySelector('button')).toBe(button);
  expect(button.textContent).toBe('Reset');
});

it.each(['html', 'htmx', 'vanilla'] as const)('supports %s keyboard filtering, propagation control and same-document navigation', framework => {
  const go = { ...interaction('go', 'keydown', [{ type: 'navigate' as const, url: '#destination' }]), keys: ['Enter'], preventDefault: true, stopPropagation: true };
  const page: UiDefinition = { schemaVersion: 1, id: 'keyboard-page', description: 'Keyboard.', sourcePath: 'keyboard.md', props: {}, root: { tag: 'input', interactions: ['go'] } };
  const { dom, create } = factory(framework, [page], [go], page.id);
  const input = create(); dom.window.document.body.append(input);
  let bubbled = 0; dom.window.document.body.addEventListener('keydown', () => bubbled++);
  const ignored = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); input.dispatchEvent(ignored);
  expect(ignored.defaultPrevented).toBe(false); expect(bubbled).toBe(1); expect(dom.window.location.hash).toBe('');
  const accepted = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); input.dispatchEvent(accepted);
  expect(accepted.defaultPrevented).toBe(true); expect(bubbled).toBe(1); expect(dom.window.location.hash).toBe('#destination');
});

it.each(['html', 'htmx', 'vanilla'] as const)('initializes %s select state after mounting options and reflects selected values', framework => {
  const select = interaction('select-title', 'change', [{ type: 'set-state', state: 'title', fromEvent: 'value' }]);
  const page: UiDefinition = {
    schemaVersion: 1, id: 'select-page', description: 'Select state.', sourcePath: 'select.md', props: {}, state: { title: { type: 'string', default: 'second' } },
    root: { tag: 'div', children: [
      { tag: 'select', attrs: { value: '{{state.title}}' }, interactions: ['select-title'], children: [
        { tag: 'option', attrs: { value: 'first' }, text: 'First' }, { tag: 'option', attrs: { value: 'second' }, text: 'Second' },
      ] },
      { tag: 'output', text: '{{state.title}}' },
    ] },
  };
  const { dom, create } = factory(framework, [page], [select], page.id);
  const root = create() as HTMLElement; dom.window.document.body.append(root);
  const input = root.querySelector('select')!;
  expect(input.value).toBe('second');
  input.value = 'first'; input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  expect(root.querySelector('output')?.textContent).toBe('first');
});

it.each(['html', 'htmx', 'vanilla'] as const)('reads %s event values from the bound element when a child triggers the event', framework => {
  const read = interaction('read-value', 'change', [{ type: 'set-state', state: 'title', fromEvent: 'value' }]);
  const page: UiDefinition = {
    schemaVersion: 1, id: 'bound-event', description: 'Bound event values.', sourcePath: 'bound-event.md', props: {}, state: { title: { type: 'string', default: 'Initial' } },
    root: { tag: 'div', children: [
      { tag: 'select', attrs: { value: 'Bound value' }, interactions: ['read-value'], children: [
        { tag: 'option', attrs: { value: 'Bound value' }, text: 'Bound target' }, { tag: 'option', attrs: { value: 'Nested value' }, text: 'Nested target' },
      ] },
      { tag: 'output', text: '{{state.title}}' },
    ] },
  };
  const { dom, create } = factory(framework, [page], [read], page.id);
  const root = create() as HTMLElement; dom.window.document.body.append(root);
  root.querySelector('option[value="Nested value"]')!.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  expect(root.querySelector('output')?.textContent).toBe('Bound value');
});

it.each(['html', 'htmx', 'vanilla'] as const)('rejects %s unsafe runtime destinations before navigation', framework => {
  const go = interaction('navigate', 'click', [{ type: 'navigate', url: '{{destination}}' }]);
  const page: UiDefinition = {
    schemaVersion: 1, id: 'navigation-page', description: 'Validated navigation.', sourcePath: 'navigation.md',
    props: { destination: { type: 'string', default: '#safe' } }, root: { tag: 'button', text: 'Navigate', interactions: ['navigate'] },
  };
  const { dom, create } = factory(framework, [page], [go], page.id);
  const errors: string[] = []; dom.window.addEventListener('error', event => { errors.push(event.message); event.preventDefault(); });
  const root = create({ destination: 'javascript:alert(1)' }) as HTMLElement; dom.window.document.body.append(root); root.click();
  expect(errors).toEqual(['Unsafe interaction navigation URL.']);
  expect(dom.window.location.href).toBe('https://example.test/start');
});
