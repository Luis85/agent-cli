import type { UiDefinition, UiFramework, UiNode, UiValue } from '../domain/ui.ts';
import type { WriteRequest } from '../domain/file.ts';
import { vaultPath } from '../domain/file.ts';
import { ensure } from '../domain/errors.ts';
import { reactStyleHelper } from './ui-react-style.ts';

const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const booleanAttrs = new Set('allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'.split(' '));
const ordered = <T>(object: Record<string, T>) => Object.entries(object).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const json = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const html = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const className = (definition: UiDefinition) => definition.name ?? definition.id.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('');
const defaults = (definition: UiDefinition): Record<string, UiValue> => Object.fromEntries(ordered(definition.props).filter(([, prop]) => prop.default !== undefined).map(([key, prop]) => [key, prop.default!]));

/** The importable artifact used by UI composition and Storybook. */
export function componentArtifact(definition: UiDefinition, framework: UiFramework) {
  const extension = { html: 'js', htmx: 'js', vanilla: 'js', react: 'tsx', vue: 'vue', svelte: 'svelte', angular: 'ts' }[framework];
  return { fileName: `${definition.id}.${extension}`, exportName: framework === 'angular' ? `${className(definition)}Component` : ['html', 'htmx', 'vanilla'].includes(framework) ? `create${className(definition)}` : className(definition), namedExport: framework === 'angular' };
}

function pieces(value: string): { literal: string }[] | ({ literal: string } | { prop: string })[] {
  const result: ({ literal: string } | { prop: string })[] = [];
  let last = 0;
  for (const match of value.matchAll(/\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}/g)) {
    if (match.index! > last) result.push({ literal: value.slice(last, match.index) });
    result.push({ prop: match[1]! }); last = match.index! + match[0].length;
  }
  if (last < value.length || !result.length) result.push({ literal: value.slice(last) });
  return result;
}

function expression(value: UiValue, scope = 'props'): string {
  if (typeof value !== 'string') return json(value);
  const parts = pieces(value);
  if (parts.length === 1 && 'prop' in parts[0]!) return `${scope}[${json(parts[0].prop)}]`;
  return parts.map(part => 'literal' in part ? json(part.literal) : `('' + (${scope}[${json(part.prop)}] ?? ''))`).join(' + ');
}

function evaluate(value: UiValue, props: Record<string, UiValue>): UiValue | undefined {
  if (typeof value !== 'string') return value;
  const parts = pieces(value);
  if (parts.length === 1 && 'prop' in parts[0]!) return props[parts[0].prop];
  return parts.map(part => 'literal' in part ? part.literal : String(props[part.prop] ?? '')).join('');
}

function textExpression(value: string, scope = 'props'): string {
  const parts = pieces(value);
  const result = expression(value, scope);
  return parts.length === 1 && 'prop' in parts[0]! ? `(${result} ?? '')` : result;
}

function references(node: UiNode): string[] {
  if ('slot' in node) return [];
  return [...('component' in node ? [node.component] : []), ...(node.children ?? []).flatMap(references)];
}

function staticMarkup(node: UiNode, props: Record<string, UiValue>, definitions: Map<string, UiDefinition>, children = ''): string {
  if ('slot' in node) return children;
  const childMarkup = (node.children ?? []).map(child => staticMarkup(child, props, definitions, children)).join('');
  if ('component' in node) {
    const definition = definitions.get(node.component)!;
    const passed = Object.fromEntries(ordered(node.props ?? {}).flatMap(([key, value]) => {
      const evaluated = evaluate(value, props);
      return evaluated === undefined ? [] : [[key, evaluated]];
    }));
    return staticMarkup(definition.root, { ...defaults(definition), ...passed }, definitions, childMarkup);
  }
  const attrs = ordered(node.attrs ?? {}).map(([key, original]) => {
    const value = evaluate(original, props);
    if (value == null || (booleanAttrs.has(key.toLowerCase()) && value === false)) return '';
    return booleanAttrs.has(key.toLowerCase()) && value === true ? ` ${key}` : ` ${key}="${html(value)}"`;
  }).join('');
  return `<${node.tag}${attrs}>${voidTags.has(node.tag) ? '' : `${node.text === undefined ? '' : html(evaluate(node.text, props))}${childMarkup}</${node.tag}>`}`;
}

function domModule(definition: UiDefinition, definitions: Map<string, UiDefinition>): string {
  const refs = [...new Set(references(definition.root))].sort();
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  const imports = refs.map(id => `import ${aliases.get(id)} from ${json(`./${definitions.get(id)!.id}.js`)};`).join('\n');
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return 'slot(children)';
    const children = `[${(node.children ?? []).map(nodeCode).join(', ')}]`;
    if ('component' in node) return `${aliases.get(node.component)}({${ordered(node.props ?? {}).map(([key, value]) => `${json(key)}: ${expression(value)}`).join(', ')}}, ${children})`;
    return `element(${json(node.tag)}, {${ordered(node.attrs ?? {}).map(([key, value]) => `${json(key)}: ${expression(value)}`).join(', ')}}, ${node.text === undefined ? 'null' : expression(node.text)}, ${children})`;
  }
  return `${imports}${imports ? '\n\n' : ''}const booleanAttributes = new Set(${json([...booleanAttrs].sort())});
function slot(children) {
  const fragment = document.createDocumentFragment();
  for (const child of children) if (child != null) fragment.append(child);
  return fragment;
}
function element(tag, attributes, text, children) {
  const result = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null || (booleanAttributes.has(key.toLowerCase()) && value === false)) continue;
    result.setAttribute(key, booleanAttributes.has(key.toLowerCase()) && value === true ? '' : String(value));
  }
  if (text != null) result.append(document.createTextNode(String(text)));
  result.append(...children);
  return result;
}

/** Create DOM using text nodes and attributes; caller owns mounting and event listeners. */
export default function ${componentArtifact(definition, 'html').exportName}(input = {}, children = []) {
  const props = { ...${json(defaults(definition))}, ...input };
${defaultAssignments(definition)}
  return ${nodeCode(definition.root)};
}
`;
}

function defaultAssignments(definition: UiDefinition): string {
  return ordered(definition.props).filter(([, prop]) => prop.default !== undefined).map(([key, prop]) => `  if (props[${json(key)}] === undefined) props[${json(key)}] = ${json(prop.default)};`).join('\n');
}

function domDeclaration(definition: UiDefinition): string {
  const required = Object.values(definition.props).some(prop => prop.required && prop.default === undefined);
  return `export interface ${className(definition)}Props {\n${ordered(definition.props).map(([key, prop]) => `  ${json(key)}${prop.required && prop.default === undefined ? '' : '?'}: ${prop.type};`).join('\n')}\n}\n\nexport default function ${componentArtifact(definition, 'html').exportName}(input${required ? '' : '?'}: ${className(definition)}Props, children?: readonly (Node | string | null | undefined)[]): HTMLElement | DocumentFragment;\n`;
}

const reactNames: Record<string, string> = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', autofocus: 'autoFocus', autocomplete: 'autoComplete', colspan: 'colSpan', rowspan: 'rowSpan', maxlength: 'maxLength', minlength: 'minLength', contenteditable: 'contentEditable', spellcheck: 'spellCheck', srcset: 'srcSet', usemap: 'useMap', datetime: 'dateTime', crossorigin: 'crossOrigin', novalidate: 'noValidate', formnovalidate: 'formNoValidate', acceptcharset: 'acceptCharset', httpequiv: 'httpEquiv' };
function reactModule(definition: UiDefinition, definitions: Map<string, UiDefinition>): string {
  const refs = [...new Set(references(definition.root))].sort();
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  let usesStyle = false;
  let usesAttributes = false;
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return 'props.children';
    const children = (node.children ?? []).map(nodeCode);
    if ('tag' in node && node.text !== undefined) children.unshift(`globalThis.String(${textExpression(node.text)})`);
    const attrs = ordered('tag' in node ? node.attrs ?? {} : node.props ?? {}).map(([key, value]) => {
      const isStyle = 'tag' in node && key === 'style';
      if (isStyle) usesStyle = true;
      const isAttribute = 'tag' in node && !isStyle && !booleanAttrs.has(key.toLowerCase());
      if (isAttribute) usesAttributes = true;
      const rendered = isStyle ? `css(${expression(value)})` : isAttribute ? `attribute(${expression(value)})` : expression(value);
      return `${json('tag' in node ? reactNames[key] ?? key : key)}: ${rendered}`;
    });
    return `_uiCreateElement(${'tag' in node ? json(node.tag) : aliases.get(node.component)}, {${attrs.join(', ')}}${children.length ? `, ${children.join(', ')}` : ''})`;
  }
  const body = nodeCode(definition.root);
  const propTypes = ordered(definition.props).map(([key, prop]) => `  ${json(key)}${prop.required && prop.default === undefined ? '' : '?'}: ${prop.type};`).join('\n');
  return `import { createElement as _uiCreateElement, type ReactNode as _UiReactNode${usesStyle ? ', type CSSProperties as _UiCSSProperties' : ''} } from 'react';
${refs.map(id => `import ${aliases.get(id)} from ${json(`./${definitions.get(id)!.id}`)};`).join('\n')}
export interface ${className(definition)}Props {
${propTypes}${propTypes ? '\n' : ''}  children?: _UiReactNode;
}
${usesStyle ? reactStyleHelper : ''}
${usesAttributes ? `function attribute(value: unknown): string | undefined {\n  return value == null ? undefined : globalThis.String(value);\n}\n` : ''}
export default function ${className(definition)}(input: ${className(definition)}Props) {
  const props = { ...${json(defaults(definition))}, ...input };
${defaultAssignments(definition)}
  return ${body};
}
`;
}

function vueModule(definition: UiDefinition, definitions: Map<string, UiDefinition>): string {
  const refs = [...new Set(references(definition.root))].sort();
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return '<slot />';
    const tag = 'tag' in node ? node.tag : aliases.get(node.component)!;
    const attrs = ordered('tag' in node ? node.attrs ?? {} : node.props ?? {}).map(([key, value]) => ` :${key}="${html(expression(value))}"`).join('');
    const text = 'tag' in node && node.text !== undefined ? `{{ ${html(expression(node.text))} }}` : '';
    return `<${tag}${attrs}>${'tag' in node && voidTags.has(tag) ? '' : `${text}${(node.children ?? []).map(nodeCode).join('')}</${tag}>`}`;
  }
  return `<script setup lang="ts">
${refs.map(id => `import ${aliases.get(id)} from ${json(`./${definitions.get(id)!.id}.vue`)};`).join('\n')}
const props = defineProps({
${ordered(definition.props).map(([key, prop]) => `  ${json(key)}: { type: ${prop.type === 'string' ? 'String' : prop.type === 'number' ? 'Number' : 'Boolean'}, required: ${Boolean(prop.required && prop.default === undefined)}${prop.default !== undefined ? `, default: ${json(prop.default)}` : prop.type === 'boolean' ? ', default: undefined' : ''} },`).join('\n')}
});
</script>

<template>
  ${nodeCode(definition.root)}
</template>
`;
}

function svelteModule(definition: UiDefinition, definitions: Map<string, UiDefinition>): string {
  const refs = [...new Set(references(definition.root))].sort();
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  function svelteExpression(value: UiValue): string { return expression(value, '_uiProps'); }
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return '<slot />';
    const tag = 'tag' in node ? node.tag : aliases.get(node.component)!;
    const attrs = ordered('tag' in node ? node.attrs ?? {} : node.props ?? {}).map(([key, value]) => ` ${key}={${svelteExpression(value)}}`).join('');
    const text = 'tag' in node && node.text !== undefined ? `{${textExpression(node.text, '_uiProps')}}` : '';
    return `<${tag}${attrs}>${'tag' in node && voidTags.has(tag) ? '' : `${text}${(node.children ?? []).map(nodeCode).join('')}</${tag}>`}`;
  }
  return `<script lang="ts">
${refs.map(id => `  import ${aliases.get(id)} from ${json(`./${definitions.get(id)!.id}.svelte`)};`).join('\n')}
${ordered(definition.props).map(([key, prop], index) => `  let _uiProp${index}: ${prop.type}${prop.required || prop.default !== undefined ? '' : ' | undefined'}${prop.default !== undefined ? ` = ${json(prop.default)}` : prop.required ? '' : ' = undefined'};\n  export { _uiProp${index} as ${key} };`).join('\n')}
  $: _uiProps = {${ordered(definition.props).map(([key], index) => `${json(key)}: _uiProp${index}`).join(', ')}};
</script>

${nodeCode(definition.root)}
`;
}

function angularModule(definition: UiDefinition, definitions: Map<string, UiDefinition>): string {
  const refs = [...new Set(references(definition.root))].sort();
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  function angularExpression(value: UiValue): string {
    if (typeof value !== 'string') return json(value);
    const parts = pieces(value);
    if (parts.length === 1 && 'prop' in parts[0]!) return parts[0].prop;
    return parts.map(part => 'literal' in part ? json(part.literal) : `('' + (${part.prop} ?? ''))`).join(' + ');
  }
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return '<ng-content></ng-content>';
    const tag = 'tag' in node ? node.tag : `ui-${node.component}`;
    const attrs = ordered('tag' in node ? node.attrs ?? {} : node.props ?? {}).map(([key, value]) => {
      const expr = angularExpression(value);
      return ` [${'tag' in node ? `attr.${key}` : key}]="${html('tag' in node && booleanAttrs.has(key.toLowerCase()) ? `$any(${expr}) === true ? '' : ($any(${expr}) === false ? null : (${expr}))` : expr)}"`;
    }).join('');
    const text = 'tag' in node && node.text !== undefined ? `{{ ${html(angularExpression(node.text))} }}` : '';
    return `<${tag}${attrs}>${'tag' in node && voidTags.has(tag) ? '' : `${text}${(node.children ?? []).map(nodeCode).join('')}</${tag}>`}`;
  }
  return `import { Component, Input } from '@angular/core';
${refs.map(id => `import { ${componentArtifact(definitions.get(id)!, 'angular').exportName} as ${aliases.get(id)} } from ${json(`./${definitions.get(id)!.id}`)};`).join('\n')}

@Component({
  selector: ${json(`ui-${definition.id}`)},
  standalone: true,
  imports: [${refs.map(id => aliases.get(id)).join(', ')}],
  template: ${json(nodeCode(definition.root))},
})
export class ${componentArtifact(definition, 'angular').exportName} {
${ordered(definition.props).map(([key, prop]) => {
  const options = prop.default !== undefined ? `{ transform: (value: ${prop.type} | undefined) => value === undefined ? ${json(prop.default)} : value }` : prop.required ? '{ required: true }' : '';
  return `  @Input(${options}) ${key}${prop.required && prop.default === undefined ? '!' : ''}: ${prop.type}${!prop.required && prop.default === undefined ? ' | undefined' : ''}${prop.default === undefined ? '' : ` = ${json(prop.default)}`};`;
}).join('\n')}
}
`;
}

/** Pure generation: callers validate definitions and commit the returned write plan. */
export function renderUiComponents(input: readonly UiDefinition[], framework: UiFramework, outputDirectory: string): WriteRequest[] {
  vaultPath(outputDirectory);
  ensure(['html', 'htmx', 'vanilla', 'vue', 'svelte', 'react', 'angular'].includes(framework), 'INVALID_UI_FRAMEWORK', `Unknown UI framework: ${framework}`);
  const definitions = new Map(input.map(definition => [definition.id, definition]));
  ensure(definitions.size === input.length, 'INVALID_UI_LIBRARY', 'Duplicate UI component IDs.');
  const visited = new Set<string>();
  function visit(id: string, stack: string[]) {
    ensure(!stack.includes(id), 'INVALID_UI_LIBRARY', `Cyclic component reference: ${[...stack, id].join(' -> ')}`);
    if (visited.has(id)) return;
    const definition = definitions.get(id);
    ensure(definition, 'INVALID_UI_LIBRARY', `Unknown UI component: ${id}`);
    for (const child of references(definition.root)) visit(child, [...stack, id]);
    visited.add(id);
  }
  for (const id of definitions.keys()) visit(id, []);
  const writes: WriteRequest[] = [];
  for (const definition of [...input].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const artifact = componentArtifact(definition, framework);
    const source = framework === 'react' ? reactModule(definition, definitions) : framework === 'vue' ? vueModule(definition, definitions) : framework === 'svelte' ? svelteModule(definition, definitions) : framework === 'angular' ? angularModule(definition, definitions) : domModule(definition, definitions);
    writes.push({ path: `${outputDirectory}/${artifact.fileName}`, bytes: new TextEncoder().encode(source) });
    if (['html', 'htmx', 'vanilla'].includes(framework)) {
      writes.push({ path: `${outputDirectory}/${definition.id}.html`, bytes: new TextEncoder().encode(staticMarkup(definition.root, defaults(definition), definitions) + '\n') });
      writes.push({ path: `${outputDirectory}/${definition.id}.d.ts`, bytes: new TextEncoder().encode(domDeclaration(definition)) });
    }
  }
  return writes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
