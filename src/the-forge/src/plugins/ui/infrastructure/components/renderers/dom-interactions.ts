import { componentDependencies } from '../../../domain/components/library.ts';
import type { InteractionDefinition } from '../../../domain/interactions/definition.ts';
import type { UiDefinition, UiNode } from '../../../domain/components/definition.ts';
import { uiBooleanAttributes } from '../../../domain/components/syntax.ts';
import { ordered, defaults, json, expression, defaultAssignments } from '../rendering.ts';
import { domFactory, domProps, domSlot, domTypedefs } from './dom-source.ts';
import { groupElementInteractions, interactionPrefix, renderInteractionHandlers, stateDefaults, stateType } from '../interactions/handlers.ts';

/** DOM updates retain mounted components, projected children and browser-managed state. */
export function reactiveDomModule(definition: UiDefinition, interactions: readonly InteractionDefinition[]): string {
  const references = componentDependencies(definition.root);
  const aliases = new Map(references.map((id, index) => [id, `UiChild_${index}`]));
  const imports = references.map(id => `import ${aliases.get(id)} from ${json(`./${id}.js`)};`).join('\n');
  const prefix = interactionPrefix(definition);
  const used = { slot: false, component: false, element: false };
  function nodeCode(node: UiNode): string {
    if ('slot' in node) { used.slot = true; return 'slot(children)'; }
    const children = `[${(node.children ?? []).map(nodeCode).join(', ')}]`;
    if ('component' in node) { used.component = true; return `component(${aliases.get(node.component)}, () => ({${ordered(node.props ?? {}).map(([key, value]) => `${json(key)}: ${expression(value)}`).join(', ')}}), ${children})`; }
    used.element = true;
    const listeners = groupElementInteractions(node, interactions, prefix).map(({ event, handlers }) => `${json(event)}: [${handlers.join(', ')}]`).join(', ');
    return `element(${json(node.tag)}, () => ({${ordered(node.attrs ?? {}).map(([key, value]) => `${json(key)}: ${expression(value)}`).join(', ')}}), ${node.text === undefined ? 'null' : `() => ${expression(node.text)}`}, ${children}, {${listeners}})`;
  }
  const root = nodeCode(definition.root);
  const handlers = renderInteractionHandlers(definition, interactions, { typescript: false, prefix, commit: next => `Object.assign(_uiState, ${next}); refresh();` });
  const assignments = defaultAssignments(definition);
  const usesState = root.includes('_uiState') || handlers.includes('_uiState');
  return `${imports}${imports ? '\n\n' : ''}${domTypedefs(definition)}${used.element ? `const booleanAttributes = new Set(${json([...uiBooleanAttributes].sort())});\n` : ''}const updateProps = Symbol.for('forge.ui.updateProps');

${domFactory(definition, 'Create a live component; mounting and removal remain owned by the caller.', { props: true, children: used.slot })}
${domProps(definition)}${assignments}${assignments ? '\n' : ''}${usesState ? `  /** @type {${stateType(definition)}} */\n  const _uiState = ${json(stateDefaults(definition))};\n` : ''}  /** @type {Array<() => void>} */
  const updates = [];
  const refresh = () => { for (const update of updates) update(); };
${handlers}${handlers ? '\n' : ''}${used.slot ? indent(domSlot) : ''}${used.component ? liveComponent : ''}${used.element ? liveElement : ''}  const result = ${root};
  Object.defineProperty(result, updateProps, { configurable: true, value: (/** @type {Props} */ next) => {
    for (const key of Object.keys(props)) Reflect.deleteProperty(props, key);
    Object.assign(props, ${json(defaults(definition))}, next);
${assignments}${assignments ? '\n' : ''}    refresh();
  } });
  return result;
}
`;
}

const indent = (source: string) => source.split('\n').map(line => (line ? `  ${line}` : line)).join('\n');

/** Renders a child factory; a live child re-renders with new values when this component refreshes. */
const liveComponent = `  /**
   * @template P
   * @param {(input: P, children: DomChildren) => HTMLElement | DocumentFragment} factory @param {() => P} values @param {DomChildren} content
   */
  function component(factory, values, content) {
    const result = factory(values(), content);
    // Capture before a parent sharing this root attaches its own callback.
    /** @type {((values: P) => void) | undefined} */
    const update = Reflect.get(result, updateProps);
    if (update) updates.push(() => update(values()));
    return result;
  }
`;

/** Creates an element whose attributes and text follow the props and state on every refresh. */
const liveElement = `  /**
   * @param {string} tag @param {() => Record<string, unknown>} attributes @param {(() => unknown) | null} text
   * @param {readonly Node[]} content @param {Record<string, Array<(event: Event) => unknown>>} listeners
   */
  function element(tag, attributes, text, content, listeners) {
    const result = document.createElement(tag);
    /** @type {Record<string, string | null>} */
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
        const value = String(text?.() ?? '');
        if (textNode.data !== value) textNode.data = value;
      }
    };
    result.append(...content);
    update(); updates.push(update);
    for (const [event, handlers] of Object.entries(listeners)) result.addEventListener(event, value => { for (const handler of handlers) handler(value); });
    return result;
  }
`;

export function hasReactiveDom(definitions: Map<string, UiDefinition>): boolean {
  function interactive(node: UiNode): boolean {
    return ('tag' in node && !!node.interactions?.length) || ('children' in node && !!node.children?.some(interactive));
  }
  return [...definitions.values()].some(definition => Object.keys(definition.state ?? {}).length > 0 || interactive(definition.root));
}
