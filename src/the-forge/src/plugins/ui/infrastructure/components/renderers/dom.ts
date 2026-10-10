import { componentDependencies } from '../../../domain/components/library.ts';
import type { UiDefinition, UiNode, UiValue } from '../../../domain/components/definition.ts';
import type { InteractionDefinition } from '../../../domain/interactions/definition.ts';
import { uiVoidTags as voidTags, uiBooleanAttributes as booleanAttrs } from '../../../domain/components/syntax.ts';
import { ordered, html, defaults, evaluate, json, expression, defaultAssignments, componentArtifact, className } from '../rendering.ts';
import { hasReactiveDom, reactiveDomModule } from './dom-interactions.ts';
import { stateDefaults } from '../interactions/handlers.ts';

export function staticMarkup(node: UiNode, props: Record<string, UiValue>, definitions: Map<string, UiDefinition>, children = '', state: Record<string, UiValue> = {}): string {
  if ('slot' in node) return children;
  const childMarkup = (node.children ?? []).map(child => staticMarkup(child, props, definitions, children, state)).join('');
  if ('component' in node) {
    const definition = definitions.get(node.component)!;
    const passed = Object.fromEntries(ordered(node.props ?? {}).flatMap(([key, value]) => {
      const evaluated = evaluate(value, props, state);
      return evaluated === undefined ? [] : [[key, evaluated]];
    }));
    return staticMarkup(definition.root, { ...defaults(definition), ...passed }, definitions, childMarkup, stateDefaults(definition));
  }
  const attrs = ordered(node.attrs ?? {}).map(([key, original]) => {
    const value = evaluate(original, props, state);
    if (value == null || (booleanAttrs.has(key.toLowerCase()) && value === false)) return '';
    return booleanAttrs.has(key.toLowerCase()) && value === true ? ` ${key}` : ` ${key}="${html(value)}"`;
  }).join('');
  return `<${node.tag}${attrs}>${voidTags.has(node.tag) ? '' : `${node.text === undefined ? '' : html(evaluate(node.text, props, state))}${childMarkup}</${node.tag}>`}`;
}

export function domModule(definition: UiDefinition, definitions: Map<string, UiDefinition>, interactions: readonly InteractionDefinition[] = []): string {
  if (hasReactiveDom(definitions)) return reactiveDomModule(definition, interactions);
  const refs = componentDependencies(definition.root);
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

export function domDeclaration(definition: UiDefinition): string {
  const required = Object.values(definition.props).some(prop => prop.required && prop.default === undefined);
  return `export interface ${className(definition)}Props {\n${ordered(definition.props).map(([key, prop]) => `  ${json(key)}${prop.required && prop.default === undefined ? '' : '?'}: ${prop.type};`).join('\n')}\n}\n\nexport default function ${componentArtifact(definition, 'html').exportName}(input${required ? '' : '?'}: ${className(definition)}Props, children?: readonly (Node | string | null | undefined)[]): HTMLElement | DocumentFragment;\n`;
}
