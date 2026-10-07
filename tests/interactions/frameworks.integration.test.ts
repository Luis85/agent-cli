import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { parse, compileScript } from '@vue/compiler-sfc';
import { compile } from 'svelte/compiler';
import { parseTemplate } from '@angular/compiler';
import type { UiDefinition } from '../../src/the-forge/domain/ui/definition.ts';
import type { InteractionDefinition } from '../../src/the-forge/domain/interactions/definition.ts';
import { renderUiComponents } from '../../src/the-forge/infrastructure/ui/renderers.ts';
import { formDefinition, formInteractions, formRuntimeScenario } from '../support/interaction-form-runtime.ts';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const interaction = (id: string, event: InteractionDefinition['event'], actions: InteractionDefinition['actions'], options: Partial<InteractionDefinition> = {}): InteractionDefinition => ({
  schemaVersion: 1, id, event, actions, description: id, sourcePath: `interactions/${id}.md`, ...options,
});
const interactions: InteractionDefinition[] = [
  ...formInteractions,
  interaction('toggle-open', 'click', [{ type: 'toggle-state', state: 'open' }, { type: 'emit', event: 'open-changed', detail: { open: '{{state.open}}' } }]),
  interaction('edit-text', 'input', [{ type: 'set-state', state: 'text', fromEvent: 'value' }, { type: 'emit', event: 'text-changed', detail: { text: '{{state.text}}' } }]),
  interaction('edit-check', 'change', [{ type: 'set-state', state: 'checked', fromEvent: 'checked' }]),
  interaction('commit-text', 'change', [{ type: 'set-state', state: 'committed', fromEvent: 'value' }]),
  interaction('toggle-child', 'click', [{ type: 'toggle-state', state: 'armed' }]),
  interaction('emit-only', 'click', [{ type: 'emit', event: 'requested', detail: { source: 'fixture' } }]),
  interaction('reset-text', 'keydown', [{ type: 'set-state', state: 'text', value: '{{label}}' }, { type: 'set-state', state: 'count', value: 7 }], { keys: ['Enter'], preventDefault: true, stopPropagation: true }),
];
const definitions: UiDefinition[] = [
  formDefinition,
  {
    schemaVersion: 1, id: 'state-only', description: 'State bindings without any event handlers.', sourcePath: 'components/state-only.md',
    props: {}, state: { label: { type: 'string', default: 'Read-only state' } },
    root: { tag: 'span', text: '{{state.label}}' },
  },
  {
    schemaVersion: 1, id: 'emit-only', description: 'Events without state or props.', sourcePath: 'components/emit-only.md',
    props: {}, root: { tag: 'button', attrs: { type: 'button' }, text: 'Request', interactions: ['emit-only'] },
  },
  {
    schemaVersion: 1, id: 'interaction-child', name: 'InteractionChild', description: 'A stateful child.', sourcePath: 'components/interaction-child.md',
    props: { label: { type: 'string', default: '' } }, state: { armed: { type: 'boolean', default: false } },
    root: { tag: 'section', attrs: { 'data-child': 'true' }, children: [
      { tag: 'button', attrs: { type: 'button', 'data-action': 'child' }, interactions: ['toggle-child'], text: '{{state.armed}}' },
      { tag: 'span', attrs: { 'data-child-label': 'true' }, text: '{{label}}' },
    ] },
  },
  {
    schemaVersion: 1, id: 'interaction-page', name: 'InteractionPage', description: 'Native interaction runtime fixture.', sourcePath: 'components/interaction-page.md',
    props: { label: { type: 'string', default: 'Reset label' } },
    state: { open: { type: 'boolean', default: false }, text: { type: 'string', default: '' }, committed: { type: 'string', default: '' }, checked: { type: 'boolean', default: false }, count: { type: 'number', default: 0 } },
    root: { tag: 'div', children: [
      { tag: 'button', attrs: { type: 'button', 'data-action': 'toggle', 'aria-expanded': '{{state.open}}' }, interactions: ['toggle-open'], text: '{{state.open}}' },
      { tag: 'input', attrs: { type: 'text', 'aria-label': 'Text', 'data-action': 'text', value: '{{state.text}}' }, interactions: ['edit-text', 'reset-text'] },
      { tag: 'input', attrs: { type: 'checkbox', 'aria-label': 'Checked', 'data-action': 'check', checked: '{{state.checked}}' }, interactions: ['edit-check'] },
      { tag: 'input', attrs: { type: 'text', 'aria-label': 'Commit on change', 'data-action': 'commit', value: '{{state.committed}}' }, interactions: ['commit-text'] },
      { tag: 'span', attrs: { 'data-state': 'text' }, text: '{{state.text}}' },
      { tag: 'span', attrs: { 'data-state': 'checked' }, text: '{{state.checked}}' },
      { tag: 'span', attrs: { 'data-state': 'count' }, text: '{{state.count}}' },
      { tag: 'span', attrs: { 'data-state': 'committed' }, text: '{{state.committed}}' },
      { component: 'interaction-child', props: { label: '{{state.text}}' } },
      { component: 'form-actions' },
    ] },
  },
];

const runtimeSetup = String.raw`
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLMediaElement', 'HTMLSelectElement', 'HTMLOptionElement', 'HTMLFormElement', 'SVGElement', 'Text', 'Comment', 'Document', 'DocumentFragment', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { value: typeof dom.window[name] === 'function' && /^[a-z]/.test(name) ? dom.window[name].bind(dom.window) : dom.window[name], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
`;

const runtimeScenario = String.raw`
const first = document.createElement('main');
const second = document.createElement('main');
document.body.append(first, second);
const mounted = [await mount(first), await mount(second)];
const change = async action => { await mounted[0].flush(action); };
const find = (selector, root = first) => { const result = root.querySelector(selector); assert.ok(result, selector); return result; };
const toggle = find('[data-action="toggle"]');
const input = find('[data-action="text"]');
const check = find('[data-action="check"]');
const childButton = find('[data-action="child"]');
const observed = [];
first.addEventListener('open-changed', event => observed.push({ detail: event.detail, bubbles: event.bubbles, composed: event.composed }));
first.addEventListener('text-changed', event => observed.push({ detail: event.detail }));
assert.equal(toggle.textContent, 'false');
assert.equal(toggle.getAttribute('aria-expanded'), 'false');
await change(() => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));
assert.equal(toggle.textContent, 'true');
assert.equal(toggle.getAttribute('aria-expanded'), 'true');
assert.deepEqual(observed[0], { detail: { open: true }, bubbles: true, composed: true });
assert.equal(find('[data-action="toggle"]', second).textContent, 'false');
await change(() => childButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
assert.equal(childButton.textContent, 'true');
input.focus();
const literal = '<img src=x onerror=alert(1)> & typed';
await change(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, literal); input.dispatchEvent(new Event('input', { bubbles: true })); });
assert.equal(find('[data-state="text"]').textContent, literal);
assert.equal(find('[data-child-label]').textContent, literal);
assert.equal(find('[data-action="child"]'), childButton);
assert.equal(childButton.textContent, 'true');
assert.equal(find('[data-child-label]', second).textContent, '');
assert.equal(first.querySelector('img'), null);
assert.equal(document.activeElement, input);
assert.deepEqual(observed[1], { detail: { text: literal } });
await change(() => check.click());
assert.equal(find('[data-state="checked"]').textContent, 'true');
assert.equal(find('[data-state="checked"]', second).textContent, 'false');
const commitInput = find('[data-action="commit"]');
await change(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(commitInput, 'Draft'); commitInput.dispatchEvent(new Event('input', { bubbles: true })); });
assert.equal(find('[data-state="committed"]').textContent, '');
assert.equal(commitInput.value, 'Draft');
await change(() => commitInput.dispatchEvent(new Event('change', { bubbles: true })));
assert.equal(find('[data-state="committed"]').textContent, 'Draft');
const bubbledKeys = [];
document.body.addEventListener('keydown', event => bubbledKeys.push(event.key));
const ignored = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
await change(() => input.dispatchEvent(ignored));
assert.equal(ignored.defaultPrevented, false);
assert.equal(find('[data-state="text"]').textContent, literal);
const accepted = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
await change(() => input.dispatchEvent(accepted));
assert.equal(accepted.defaultPrevented, true);
assert.deepEqual(bubbledKeys, ['Escape']);
assert.equal(find('[data-state="text"]').textContent, 'Reset label');
assert.equal(find('[data-state="count"]').textContent, '7');
assert.equal(input.value, 'Reset label');
assert.equal(find('[data-child-label]').textContent, 'Reset label');
assert.equal(childButton.textContent, 'true');
await exerciseForms(first, dom.window, change);
for (const item of mounted) await item.dispose();
dom.window.close();
`;

const adapters = {
  react: String.raw`
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: Component } = await import('./generated/interaction-page.js');
async function mount(target) {
  const root = createRoot(target);
  await act(async () => root.render(createElement(Component)));
  return { flush: action => act(async () => { action(); }), dispose: () => act(async () => root.unmount()) };
}
`,
  vue: String.raw`
const { createApp, nextTick } = await import('vue');
const { default: Component } = await import('./generated/interaction-page.js');
async function mount(target) {
  const app = createApp(Component); app.mount(target);
  return { flush: async action => { action(); await nextTick(); }, dispose: () => app.unmount() };
}
`,
  svelte: String.raw`
const { mount: mountComponent, unmount, flushSync } = await import('svelte');
const { default: Component } = await import('./generated/interaction-page.js');
async function mount(target) {
  const instance = mountComponent(Component, { target }); flushSync();
  return { flush: async action => { flushSync(action); }, dispose: () => unmount(instance) };
}
`,
  angular: String.raw`
await import('@angular/compiler');
const { provideZonelessChangeDetection } = await import('@angular/core');
const { getTestBed, TestBed } = await import('@angular/core/testing');
const { BrowserTestingModule, platformBrowserTesting } = await import('@angular/platform-browser/testing');
const { InteractionPageComponent } = await import('./generated/interaction-page.js');
getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
TestBed.configureTestingModule({ imports: [InteractionPageComponent], providers: [provideZonelessChangeDetection()] });
async function mount(target) {
  const fixture = TestBed.createComponent(InteractionPageComponent); fixture.detectChanges(); fixture.nativeElement.removeAttribute('id'); target.append(fixture.nativeElement);
  return { flush: async action => { action(); fixture.detectChanges(); }, dispose: () => fixture.destroy() };
}
`,
};

it.each(['react', 'vue', 'svelte', 'angular'] as const)('compiles and executes %s state, form persistence, upload and download interactions', async framework => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-' + framework + '-interactions-')); temporary.push(directory);
  await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  const files = renderUiComponents(definitions, framework, 'generated', interactions);
  const roots: string[] = [];
  for (const file of files) {
    const sourcePath = join(directory, file.path);
    const source = new TextDecoder().decode(file.bytes);
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, source);
    let executable = source;
    if (framework === 'vue') {
      const parsed = parse(source, { filename: file.path });
      expect(parsed.errors, file.path).toEqual([]);
      executable = compileScript(parsed.descriptor, { id: file.path, inlineTemplate: true }).content;
    } else if (framework === 'svelte') {
      executable = compile(source, { filename: file.path, generate: 'client' }).js.code;
    } else {
      roots.push(sourcePath);
      if (framework === 'angular') {
        const template = JSON.parse(/^  template: (.+),$/m.exec(source)![1]!);
        expect(parseTemplate(template, file.path).errors, file.path).toBeNull();
      }
    }
    const compiled = ts.transpileModule(executable, { fileName: file.path, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
    const output = compiled.outputText.replace(/(from\s+["']\.\/[^"']+?)(?:\.(?:vue|svelte))?(["'])/g, '$1.js$2');
    await writeFile(sourcePath.replace(/\.(?:tsx?|vue|svelte)$/, '.js'), output);
  }
  if (roots.length) {
    const program = ts.createProgram(roots, { strict: true, noUnusedLocals: true, noUnusedParameters: true, noEmit: true, skipLibCheck: true, types: [], experimentalDecorators: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX });
    expect(ts.getPreEmitDiagnostics(program).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'))).toEqual([]);
  }
  const entry = join(directory, 'exercise.mjs');
  await writeFile(entry, runtimeSetup + adapters[framework] + formRuntimeScenario + runtimeScenario);
  execFileSync(process.execPath, ['--conditions=browser', entry], { cwd: directory, stdio: 'inherit', timeout: 30000 });
}, 45000);
