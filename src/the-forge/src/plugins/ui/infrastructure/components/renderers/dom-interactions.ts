import { componentDependencies } from '../../../domain/components/library.ts';
import type { InteractionDefinition } from '../../../domain/interactions/definition.ts';
import type { UiDefinition, UiNode } from '../../../domain/components/definition.ts';
import { uiBooleanAttributes } from '../../../domain/components/syntax.ts';
import { ordered, defaults, json, expression, defaultAssignments, componentArtifact } from '../rendering.ts';
import { groupElementInteractions, interactionPrefix, renderInteractionHandlers, stateDefaults } from '../interactions/handlers.ts';

/** DOM updates retain mounted components, projected children and browser-managed state. */
export function reactiveDomModule(definition: UiDefinition, interactions: readonly InteractionDefinition[]): string {
  const references = componentDependencies(definition.root);
  const aliases = new Map(references.map((id, index) => [id, `UiChild_${index}`]));
  const imports = references.map(id => `import ${aliases.get(id)} from ${json(`./${id}.js`)};`).join('\n');
  const prefix = interactionPrefix(definition);
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return 'slot(children)';
    const children = `[${(node.children ?? []).map(nodeCode).join(', ')}]`;
    if ('component' in node) return `component(${aliases.get(node.component)}, () => ({${ordered(node.props ?? {}).map(([key, value]) => `${json(key)}: ${expression(value)}`).join(', ')}}), ${children})`;
    const listeners = groupElementInteractions(node, interactions, prefix).map(({ event, handlers }) => `${json(event)}: [${handlers.join(', ')}]`).join(', ');
    return `element(${json(node.tag)}, () => ({${ordered(node.attrs ?? {}).map(([key, value]) => `${json(key)}: ${expression(value)}`).join(', ')}}), ${node.text === undefined ? 'null' : `() => ${expression(node.text)}`}, ${children}, {${listeners}})`;
  }
  return `${imports}${imports ? '\n\n' : ''}const booleanAttributes = new Set(${json([...uiBooleanAttributes].sort())});
const updateProps = Symbol.for('forge.ui.updateProps');

/** Create a live component; mounting and removal remain owned by the caller. */
export default function ${componentArtifact(definition, 'html').exportName}(input = {}, children = []) {
  const props = { ...${json(defaults(definition))}, ...input };
${defaultAssignments(definition)}
  const _uiState = ${json(stateDefaults(definition))};
  const updates = [];
  const refresh = () => { for (const update of updates) update(); };
${renderInteractionHandlers(definition, interactions, { typescript: false, prefix, commit: next => `Object.assign(_uiState, ${next}); refresh();` })}
  function slot(content) {
    const fragment = document.createDocumentFragment();
    for (const child of content) if (child != null) fragment.append(child);
    return fragment;
  }
  function component(factory, values, content) {
    const result = factory(values(), content);
    // Capture before a parent sharing this root attaches its own callback.
    const update = result[updateProps];
    if (update) updates.push(() => update(values()));
    return result;
  }
  function element(tag, attributes, text, content, listeners) {
    const result = document.createElement(tag);
    const previous = Object.create(null);
    const textNode = text ? document.createTextNode('') : null;
    if (textNode) result.append(textNode);
    const update = () => {
      const values = attributes();
      for (const [key, value] of Object.entries(values)) {
        const boolean = booleanAttributes.has(key.toLowerCase());
        const normalized = value == null || (boolean && value === false) ? null : boolean && value === true ? '' : String(value);
        if (Object.hasOwn(previous, key) && previous[key] === normalized) continue;
        if (normalized === null) result.removeAttribute(key); else result.setAttribute(key, normalized);
        if (key === 'value' && 'value' in result && result.value !== (normalized ?? '')) result.value = normalized ?? '';
        if (key === 'checked' && 'checked' in result) result.checked = normalized !== null;
        previous[key] = normalized;
      }
      if (textNode) {
        const value = String(text() ?? '');
        if (textNode.data !== value) textNode.data = value;
      }
    };
    result.append(...content);
    update(); updates.push(update);
    for (const [event, handlers] of Object.entries(listeners)) result.addEventListener(event, value => { for (const handler of handlers) handler(value); });
    return result;
  }
  const result = ${nodeCode(definition.root)};
  Object.defineProperty(result, updateProps, { configurable: true, value: input => {
    for (const key of Object.keys(props)) delete props[key];
    Object.assign(props, ${json(defaults(definition))}, input);
${defaultAssignments(definition)}
    refresh();
  } });
  return result;
}
`;
}

export function hasReactiveDom(definitions: Map<string, UiDefinition>): boolean {
  function interactive(node: UiNode): boolean {
    return ('tag' in node && !!node.interactions?.length) || ('children' in node && !!node.children?.some(interactive));
  }
  return [...definitions.values()].some(definition => Object.keys(definition.state ?? {}).length > 0 || interactive(definition.root));
}
