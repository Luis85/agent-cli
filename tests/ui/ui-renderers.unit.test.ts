import { describe, expect, it } from 'vitest';
import type { UiDefinition, UiFramework } from '../../src/the-forge/domain/ui/definition.ts';
import { uiFrameworks } from '../../src/the-forge/domain/ui/definition.ts';
import { componentArtifact, renderUiComponents } from '../../src/the-forge/infrastructure/ui/renderers.ts';

const button: UiDefinition = {
  schemaVersion: 1, id: 'action-button', description: 'A button', sourcePath: 'components/action-button.md',
  props: { label: { type: 'string', default: 'Save' }, disabled: { type: 'boolean', default: false } },
  root: { tag: 'button', attrs: { type: 'button', disabled: '{{disabled}}', 'aria-label': '{{label}}' }, text: '{{label}}', children: [{ slot: 'children' }] },
};
const page: UiDefinition = {
  schemaVersion: 1, id: 'page', description: '', sourcePath: 'components/page.md', props: { title: { type: 'string', default: 'Dashboard' } },
  root: { tag: 'main', children: [{ tag: 'h1', text: '{{title}}' }, { component: 'action-button', props: { label: 'Continue {{title}}' }, children: [{ tag: 'span', text: ' →' }] }] },
};
const text = (definition: UiDefinition, framework: UiFramework, extension: string) => new TextDecoder().decode(renderUiComponents([definition, button].filter((item, i, items) => items.findIndex(other => other.id === item.id) === i), framework, 'src/ui').find(file => file.path === `src/ui/${definition.id}.${extension}`)!.bytes);

describe('deterministic UI rendering', () => {
  it.each(uiFrameworks)('generates stable sorted paths and bytes independent of definition and property ordering (%s)', framework => {
    const reversedButton = { ...button, props: Object.fromEntries(Object.entries(button.props).reverse()), root: { ...button.root, attrs: { 'aria-label': '{{label}}', disabled: '{{disabled}}', type: 'button' } } };
    const expected = renderUiComponents([button, page], framework, 'custom/generated');
    const actual = renderUiComponents([page, reversedButton], framework, 'custom/generated');
    expect(actual).toEqual(expected);
    expect(actual.map(file => file.path)).toEqual(actual.map(file => file.path).sort());
    expect(actual.every(file => file.path.startsWith('custom/generated/'))).toBe(true);
  });

  it.each(['html', 'htmx', 'vanilla'] as const)('expands default props, references and projected children to portable %s HTML', framework => {
    expect(text(page, framework, 'html')).toBe('<main><h1>Dashboard</h1><button aria-label="Continue Dashboard" type="button">Continue Dashboard<span> →</span></button></main>\n');
    expect(text(page, framework, 'js')).toContain('import UiChild_0 from "./action-button.js";');
    expect(text(page, framework, 'js')).toContain('export default function createPage(input = {}, children = [])');
  });

  it('escapes dangerous text and attributes while retaining aria false and boolean attribute semantics', () => {
    const definition: UiDefinition = { ...button, props: { label: { type: 'string', default: '<script>"&\'"</script>' } }, root: { tag: 'button', attrs: { 'aria-pressed': false, title: '{{label}}', disabled: false, hidden: true, 'data-missing': null }, text: '{{label}}' } };
    const source = text(definition, 'html', 'html');
    expect(source).toBe('<button aria-pressed="false" hidden title="&lt;script&gt;&quot;&amp;&#39;&quot;&lt;/script&gt;">&lt;script&gt;&quot;&amp;&#39;&quot;&lt;/script&gt;</button>\n');
    expect(text(definition, 'html', 'js')).toContain('document.createTextNode(String(text))');
    expect(text(definition, 'html', 'js')).not.toContain('innerHTML');
  });

  it('preserves htmx attributes and emits valid void elements', () => {
    const definition: UiDefinition = { ...button, root: { tag: 'input', attrs: { 'hx-get': '/search', 'hx-trigger': 'input changed delay:300ms', name: 'q' } } };
    expect(text(definition, 'htmx', 'html')).toBe('<input hx-get="/search" hx-trigger="input changed delay:300ms" name="q">\n');
  });

  it('returns native component import contracts', () => {
    expect(componentArtifact(button, 'react')).toEqual({ fileName: 'action-button.tsx', exportName: 'ActionButton', namedExport: false });
    expect(componentArtifact(button, 'angular')).toEqual({ fileName: 'action-button.ts', exportName: 'ActionButtonComponent', namedExport: true });
    expect(componentArtifact(button, 'vue').fileName).toBe('action-button.vue');
    expect(componentArtifact(button, 'svelte').fileName).toBe('action-button.svelte');
    expect(componentArtifact(button, 'vanilla')).toEqual({ fileName: 'action-button.js', exportName: 'createActionButton', namedExport: false });
  });

  it('emits DOM factory declarations for strict TypeScript consumers including required props', () => {
    const optional = text(button, 'html', 'd.ts');
    expect(optional).toContain('input?: ActionButtonProps');
    expect(optional).toContain('"label"?: string');
    expect(optional).toContain('children?: readonly (Node | string | null | undefined)[]');
    const required: UiDefinition = { ...button, props: { label: { type: 'string', required: true } } };
    const declaration = text(required, 'vanilla', 'd.ts');
    expect(declaration).toContain('input: ActionButtonProps');
    expect(declaration).toContain('"label": string');
  });

  it('keeps literal entities out of template expression syntax and converts numeric interpolation to text', () => {
    const definition: UiDefinition = { ...button, props: { a: { type: 'number', default: 1 }, b: { type: 'number', default: 2 } }, root: { tag: 'p', text: '&quot; + injected() + &quot; {{a}}{{b}}' } };
    for (const framework of ['vue', 'angular'] as const) {
      const source = text(definition, framework, framework === 'vue' ? 'vue' : 'ts');
      expect(source).toContain('&amp;quot;');
    }
    expect(text(definition, 'html', 'html')).toContain('12');
  });

  it('preserves referenced component defaults when an optional bound prop is absent', () => {
    const optional: UiDefinition = { ...page, props: { title: { type: 'string' } }, root: { component: 'action-button', props: { label: '{{title}}' } } };
    expect(text(optional, 'html', 'html')).toBe('<button aria-label="Save" type="button">Save</button>\n');
    expect(text(button, 'angular', 'ts')).toContain('transform: (value: string | undefined) => value === undefined ? "Save" : value');
    const bare: UiDefinition = { ...button, props: { label: { type: 'string' } } };
    expect(text(bare, 'html', 'html')).toBe('<button type="button"></button>\n');
  });

  it('renders projection using each framework native slot mechanism', () => {
    expect(text(button, 'react', 'tsx')).toContain('props.children');
    expect(text(button, 'vue', 'vue')).toContain('<slot />');
    expect(text(button, 'svelte', 'svelte')).toContain('<slot />');
    expect(text(button, 'angular', 'ts')).toContain('ng-content');
  });

  it('refuses invalid destinations, frameworks and reference graphs before returning any writes', () => {
    expect(() => renderUiComponents([button], 'html', '../outside')).toThrow();
    expect(() => renderUiComponents([button], 'unsupported' as UiFramework, 'src')).toThrow();
    expect(() => renderUiComponents([button, button], 'html', 'src')).toThrow('Duplicate');
    expect(() => renderUiComponents([page], 'html', 'src')).toThrow('Unknown UI component');
    const cycle = { ...page, root: { component: 'page' } };
    expect(() => renderUiComponents([cycle], 'html', 'src')).toThrow('Cyclic');
  });
});
