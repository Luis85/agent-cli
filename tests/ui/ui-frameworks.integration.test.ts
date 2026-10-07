import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { compile } from 'svelte/compiler';
import { parseTemplate, VERSION as compilerVersion } from '@angular/compiler';
import { VERSION as angularVersion } from '@angular/core';
import { JSDOM } from 'jsdom';
import type { UiDefinition, UiFramework } from '../../src/domain/ui.ts';
import { renderUiComponents } from '../../src/infrastructure/ui-renderers.ts';
import { standardUiCatalog } from '../../src/infrastructure/ui-catalog.ts';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const definitions: UiDefinition[] = [
  {
    schemaVersion: 1, id: 'test-panel', description: 'A projected panel.', sourcePath: 'components/test-panel.md',
    props: { title: { type: 'string', default: 'Panel' } },
    root: { tag: 'section', attrs: { 'aria-label': '{{title}}' }, children: [{ slot: 'children' }] },
  },
  {
    schemaVersion: 1, id: 'test-page', description: 'Composition fixture.', sourcePath: 'components/test-page.md',
    props: {
      label: { type: 'string', default: 'A < B & "C"' }, disabled: { type: 'boolean', default: false },
      first: { type: 'number', default: 2 }, second: { type: 'number', default: 3 },
    },
    root: { component: 'test-panel', props: { title: '{{label}}' }, children: [
      { tag: 'button', attrs: { disabled: '{{disabled}}', 'data-label': '{{label}}' }, text: '{{label}}' },
      { tag: 'span', attrs: { 'data-literal': 'true' }, text: 'a &amp; b &quot; + injected() + &quot;' },
      { tag: 'span', attrs: { 'data-numbers': 'true' }, text: '{{first}}{{second}}' },
      { slot: 'children' },
    ] },
  },
];
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const suite = () => [...standardUiCatalog, ...definitions, ...['String', 'Object', 'ReactNode', 'CSSProperties'].map(name => ({
  schemaVersion: 1 as const, id: `named-${name.toLowerCase()}`, name,
  sourcePath: `components/named-${name.toLowerCase()}.md`, description: 'Names must not shadow renderer helpers.',
  props: { label: { type: 'string' as const, default: 'Safe name' } },
  root: { tag: 'span', attrs: { style: 'color: red' }, text: 'Label: {{label}}' },
}))];

async function compileTypescript(framework: 'react' | 'angular') {
  const directory = await mkdtemp(join(tmpdir(), 'forge-ui-compile-')); temporary.push(directory);
  await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
  const files = renderUiComponents(suite(), framework, 'generated');
  for (const file of files) {
    const path = join(directory, file.path);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.bytes);
  }
  const program = ts.createProgram(files.map(file => join(directory, file.path)), {
    strict: true, noEmit: true, skipLibCheck: true, types: [], experimentalDecorators: true,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  });
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic => `${diagnostic.file?.fileName}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)).toEqual([]);
}

it.each(['react', 'angular'] as const)('typechecks every standard and composed %s component with real framework types', async framework => {
  await compileTypescript(framework);
}, 30000);

it('compiles every standard and composed Vue single-file component', () => {
  for (const file of renderUiComponents(suite(), 'vue', 'generated')) {
    const result = parse(text(file.bytes), { filename: file.path });
    expect(result.errors, file.path).toEqual([]);
    const script = compileScript(result.descriptor, { id: file.path });
    const template = compileTemplate({ source: result.descriptor.template!.content, filename: file.path, id: file.path, compilerOptions: { bindingMetadata: script.bindings } });
    expect(template.errors, file.path).toEqual([]);
  }
});

it('compiles every standard and composed Svelte component', () => {
  for (const file of renderUiComponents(suite(), 'svelte', 'generated')) {
    expect(() => compile(text(file.bytes), { filename: file.path, generate: 'server' }), file.path).not.toThrow();
  }
});

it('parses every generated Angular template using the Angular compiler', () => {
  expect(angularVersion.full).toBe(compilerVersion.full);
  for (const file of renderUiComponents(suite(), 'angular', 'generated')) {
    const source = text(file.bytes);
    const expression = /^  template: (.+),$/m.exec(source)?.[1];
    expect(expression, file.path).toBeDefined();
    const template: string = JSON.parse(expression!);
    expect(parseTemplate(template, file.path).errors, file.path).toBeNull();
  }
});

/** Execute generated modules against their real dependencies, with local imports resolved in memory. */
function generatedModule(framework: UiFramework, id: string, document?: Document) {
  const files = renderUiComponents(definitions, framework, 'generated');
  const require = createRequire(import.meta.url);
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  function load(name: string): Record<string, unknown> {
    if (modules.has(name)) return modules.get(name)!.exports;
    const extension = framework === 'react' ? 'tsx' : framework === 'vue' ? 'vue' : 'js';
    const file = files.find(candidate => candidate.path === `generated/${name}.${extension}`)!;
    const source = framework === 'vue'
      ? compileScript(parse(text(file.bytes), { filename: file.path }).descriptor, { id: name, inlineTemplate: true }).content
      : text(file.bytes);
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} }; modules.set(name, module);
    const localRequire = (specifier: string) => specifier.startsWith('./') ? load(specifier.slice(2).replace(/\.(js|vue)$/, '')) : require(specifier);
    new Function('require', 'module', 'exports', 'document', code)(localRequire, module, module.exports, document);
    return module.exports;
  }
  return load(id).default;
}

it('renders React composition, props and projected children without interpreting text as markup', () => {
  const component = generatedModule('react', 'test-page') as (props: { label: string; disabled: boolean; children?: unknown }) => ReturnType<typeof createElement>;
  const label = '<img src=x onerror=alert(1)> & "quoted"';
  const markup = renderToStaticMarkup(createElement(component, { label, disabled: false }, createElement('strong', {}, 'Projected')));
  const document = new JSDOM(markup).window.document;
  expect(document.querySelector('section')?.getAttribute('aria-label')).toBe(label);
  expect(document.querySelector('button')?.textContent).toBe(label);
  expect(document.querySelector('button')?.hasAttribute('disabled')).toBe(false);
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('strong')?.textContent).toBe('Projected');
  expect(document.querySelector('[data-literal]')?.textContent).toBe('a &amp; b &quot; + injected() + &quot;');
  expect(document.querySelector('[data-numbers]')?.textContent).toBe('23');
});

it('renders Vue composition and projected children through the real server renderer', async () => {
  const component = generatedModule('vue', 'test-page') as Parameters<typeof h>[0];
  const label = '<script>literal</script> & "quoted"';
  const app = createSSRApp({ render: () => h(component, { label, disabled: false }, { default: () => h('strong', 'Projected') }) });
  const document = new JSDOM(await renderToString(app)).window.document;
  expect(document.querySelector('section')?.getAttribute('aria-label')).toBe(label);
  expect(document.querySelector('button')?.textContent).toBe(label);
  expect(document.querySelector('button')?.hasAttribute('disabled')).toBe(false);
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('strong')?.textContent).toBe('Projected');
  expect(document.querySelector('[data-literal]')?.textContent).toBe('a &amp; b &quot; + injected() + &quot;');
  expect(document.querySelector('[data-numbers]')?.textContent).toBe('23');
});

it('renders compiled Svelte composition with literal text and projected children', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-svelte-render-')); temporary.push(directory);
  await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
  const files = renderUiComponents(definitions, 'svelte', 'generated');
  const wrapper = '<script>import Page from "./test-page.svelte"; export let label;</script><Page {label}><strong>Projected</strong></Page>';
  for (const file of [...files, { path: 'generated/wrapper.svelte', bytes: new TextEncoder().encode(wrapper) }]) {
    const source = compile(text(file.bytes), { filename: file.path, generate: 'server' }).js.code;
    await writeFile(join(directory, file.path.split('/').at(-1)!.replace('.svelte', '.mjs')), source.replace(/\.svelte(["'])/g, '.mjs$1'));
  }
  const component = (await import(/* @vite-ignore */ pathToFileURL(join(directory, 'wrapper.mjs')).href)).default;
  const require = createRequire(import.meta.url);
  const { render } = await import(/* @vite-ignore */ pathToFileURL(require.resolve('svelte/server')).href) as typeof import('svelte/server');
  const label = '<script>literal</script> & "quoted"';
  const document = new JSDOM(render(component, { props: { label } }).body).window.document;
  expect(document.querySelector('section')?.getAttribute('aria-label')).toBe(label);
  expect(document.querySelector('button')?.textContent).toBe(label);
  expect(document.querySelector('button')?.hasAttribute('disabled')).toBe(false);
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('strong')?.textContent).toBe('Projected');
  expect(document.querySelector('[data-literal]')?.textContent).toBe('a &amp; b &quot; + injected() + &quot;');
  expect(document.querySelector('[data-numbers]')?.textContent).toBe('23');
});

it.each(['html', 'htmx', 'vanilla'] as const)('runs the %s DOM factory with nested props, boolean attributes and children', framework => {
  const document = new JSDOM('').window.document;
  const factory = generatedModule(framework, 'test-page', document) as (props: object, children: Node[]) => HTMLElement;
  const child = document.createElement('strong'); child.textContent = 'Projected';
  const label = '<script>not executable</script> & "quoted"';
  const result = factory({ label, disabled: false }, [child]);
  expect(result.getAttribute('aria-label')).toBe(label);
  expect(result.querySelector('button')?.textContent).toBe(label);
  expect(result.querySelector('button')?.hasAttribute('disabled')).toBe(false);
  expect(result.querySelector('script')).toBeNull();
  expect(result.querySelector('strong')).toBe(child);
  expect(factory({ disabled: true }, []).querySelector('button')?.hasAttribute('disabled')).toBe(true);
});
