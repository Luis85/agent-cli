import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse, compileScript } from '@vue/compiler-sfc';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { compile } from 'svelte/compiler';
import { JSDOM } from 'jsdom';
import type { UiDefinition, UiFramework } from '../../src/plugins/ui/domain/components/definition.ts';
import { renderUiComponents } from '../../src/plugins/ui/infrastructure/components/renderers.ts';
import { uiSafeUrl } from '../../src/plugins/ui/domain/components/syntax.ts';

// Bound URL attributes pass a runtime guard in every target, so a prop can never turn a link into a script.
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const link = (state = false): UiDefinition => ({
  schemaVersion: 1, id: 'safe-link', description: 'A bound link.', sourcePath: 'components/safe-link.md',
  props: { href: { type: 'string', default: '#' }, src: { type: 'string', default: 'icon.png' } },
  ...(state ? { state: { open: { type: 'boolean' as const, default: false } } } : {}),
  root: { tag: 'a', attrs: { href: '{{href}}', title: '{{href}}' }, children: [{ tag: 'img', attrs: { src: '{{src}}', alt: '' } }] },
});
const unsafe = ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x'];
const safe = ['#top', '/docs/guide', 'guide.md', 'https://example.com/?q=1', 'mailto:team@example.com', 'tel:+4912345'];
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const require = createRequire(import.meta.url);

function load(framework: UiFramework, definition: UiDefinition, document?: Document): unknown {
  const extension = framework === 'react' ? 'tsx' : framework === 'vue' ? 'vue' : 'js';
  const file = renderUiComponents([definition], framework, 'generated').find(candidate => candidate.path === `generated/safe-link.${extension}`)!;
  const source = framework === 'vue' ? compileScript(parse(text(file.bytes), { filename: file.path }).descriptor, { id: 'safe-link', inlineTemplate: true }).content : text(file.bytes);
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', 'document', code)(require, module, module.exports, document);
  return module.exports.default;
}

it('decides URL safety by scheme as browsers parse it', () => {
  expect(unsafe.filter(uiSafeUrl)).toEqual([]);
  expect(safe.every(uiSafeUrl)).toBe(true);
});

it.each([['html', false], ['vanilla', false], ['htmx', true]] as const)('drops unsafe bound URLs from the %s DOM factory (live: %s)', (framework, live) => {
  const document = new JSDOM('').window.document;
  const create = load(framework, link(live), document) as (props: object) => HTMLElement;
  for (const href of unsafe) {
    const element = create({ href, src: href });
    expect(element.hasAttribute('href'), href).toBe(false);
    expect(element.querySelector('img')?.hasAttribute('src'), href).toBe(false);
    expect(element.getAttribute('title')).toBe(href);
  }
  for (const href of safe) expect(create({ href }).getAttribute('href')).toBe(href);
});

it('drops an unsafe default from the static HTML markup', () => {
  const html = renderUiComponents([{ ...link(), props: { ...link().props, href: { type: 'string', default: 'javascript:alert(1)' } } }], 'html', 'generated').find(file => file.path.endsWith('.html'))!;
  expect(text(html.bytes)).toBe('<a title="javascript:alert(1)"><img alt="" src="icon.png"></a>\n');
});

it('drops unsafe bound URLs from React components', () => {
  const component = load('react', link()) as (props: object) => ReturnType<typeof createElement>;
  for (const href of unsafe) {
    const document = new JSDOM(renderToStaticMarkup(createElement(component, { href, src: href }))).window.document;
    expect(document.querySelector('a')?.hasAttribute('href'), href).toBe(false);
    expect(document.querySelector('img')?.hasAttribute('src'), href).toBe(false);
  }
  expect(new JSDOM(renderToStaticMarkup(createElement(component, { href: '/docs' }))).window.document.querySelector('a')?.getAttribute('href')).toBe('/docs');
});

it('drops unsafe bound URLs from Vue components', async () => {
  const component = load('vue', link()) as Parameters<typeof h>[0];
  for (const href of [...unsafe, '/docs']) {
    const document = new JSDOM(await renderToString(createSSRApp({ render: () => h(component, { href }) }))).window.document;
    expect(document.querySelector('a')?.getAttribute('href') ?? null, href).toBe(href === '/docs' ? '/docs' : null);
  }
});

it('drops unsafe bound URLs from Svelte components', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-svelte-url-')); temporary.push(directory);
  await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'junction');
  const file = renderUiComponents([link()], 'svelte', 'generated').find(candidate => candidate.path.endsWith('.svelte'))!;
  await writeFile(join(directory, 'safe-link.mjs'), compile(text(file.bytes), { filename: file.path, generate: 'server' }).js.code);
  const component = (await import(/* @vite-ignore */ pathToFileURL(join(directory, 'safe-link.mjs')).href)).default;
  const { render } = await import(/* @vite-ignore */ pathToFileURL(require.resolve('svelte/server')).href) as typeof import('svelte/server');
  for (const href of [...unsafe, '/docs']) {
    const document = new JSDOM(render(component, { props: { href } }).body).window.document;
    expect(document.querySelector('a')?.getAttribute('href') ?? null, href).toBe(href === '/docs' ? '/docs' : null);
  }
});
