import type { InteractionDefinition } from '../../../domain/interactions/definition.ts';
import { componentInteractions, groupElementInteractions, interactionPrefix, renderInteractionHandlers, stateDefaults, stateType } from '../interactions/handlers.ts';
import { interactionUsesState, interactionValues } from '../../../domain/components/interactions.ts';
import { componentDependencies } from '../../../domain/components/library.ts';
import type { UiDefinition, UiNode, UiValue } from '../../../domain/components/definition.ts';
import { uiBooleanAttributes as booleanAttrs, uiBindings, uiWholeBinding } from '../../../domain/components/syntax.ts';
import { ordered, textExpression, json, expression, defaults, defaultAssignments, className } from '../rendering.ts';
import { reactStyleHelper } from './react-style.ts';

const reactNames: Record<string, string> = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', autofocus: 'autoFocus', autocomplete: 'autoComplete', colspan: 'colSpan', rowspan: 'rowSpan', maxlength: 'maxLength', minlength: 'minLength', contenteditable: 'contentEditable', spellcheck: 'spellCheck', srcset: 'srcSet', usemap: 'useMap', datetime: 'dateTime', crossorigin: 'crossOrigin', novalidate: 'noValidate', formnovalidate: 'formNoValidate', acceptcharset: 'acceptCharset', httpequiv: 'httpEquiv' };
export function reactModule(definition: UiDefinition, definitions: Map<string, UiDefinition>, interactions: readonly InteractionDefinition[] = []): string {
  const prefix = interactionPrefix(definition);
  const state = `${prefix}State`;
  const selectedInteractions = componentInteractions(definition, interactions);
  const interactive = Object.keys(definition.state ?? {}).length > 0 || selectedInteractions.length > 0;
  const mutatesState = selectedInteractions.some(interaction => interaction.actions.some(action => action.type === 'set-state' || action.type === 'toggle-state'));
  let usesProps = Object.values(definition.props).some(prop => prop.default !== undefined);
  let usesState = selectedInteractions.some(interactionUsesState);
  const trackBindings = (value: UiValue): void => {
    for (const binding of uiBindings(value)) {
      if (binding.startsWith('state.')) usesState = true;
      else usesProps = true;
    }
  };
  for (const interaction of selectedInteractions) for (const value of interactionValues(interaction)) trackBindings(value);
  const refs = componentDependencies(definition.root);
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  let usesStyle = false;
  let usesAttributes = false;
  let usesControls = false;
  function nodeCode(node: UiNode): string {
    if ('slot' in node) { usesProps = true; return 'props.children'; }
    const children = (node.children ?? []).map(nodeCode);
    if ('tag' in node && node.text !== undefined) { trackBindings(node.text); children.unshift(`globalThis.String(${textExpression(node.text, 'props', state)})`); }
    const controls: string[] = [];
    const attrs = ordered('tag' in node ? node.attrs ?? {} : node.props ?? {}).flatMap(([key, value]) => {
      trackBindings(value);
      if (interactive && 'tag' in node && ((key === 'value' && ['input', 'textarea', 'select'].includes(node.tag)) || (key === 'checked' && node.tag === 'input'))) {
        usesControls = true;
        const rendered = expression(value, 'props', state);
        const property = `(element as HTMLInputElement).${key}`;
        const controlValue = value === null ? "''" : uiWholeBinding(value) ? `(${rendered} ?? '')` : rendered;
        const converted = key === 'checked' ? `(${rendered} != null && (${rendered} as unknown) !== false)` : `globalThis.String(${controlValue})`;
        controls.push(`if (!globalThis.Object.hasOwn(previous, ${json(key)}) || previous[${json(key)}] !== ${converted}) ${property} = ${converted}; previous[${json(key)}] = ${converted};`);
        return [`${key === 'checked' ? 'defaultChecked' : 'defaultValue'}: ${converted}`];
      }
      const isStyle = 'tag' in node && key === 'style';
      if (isStyle) usesStyle = true;
      const isAttribute = 'tag' in node && !isStyle && !booleanAttrs.has(key.toLowerCase());
      if (isAttribute) usesAttributes = true;
      const rendered = isStyle ? `css(${expression(value, 'props', state)})` : isAttribute ? `attribute(${expression(value, 'props', state)})` : expression(value, 'props', state);
      return [`${json('tag' in node ? reactNames[key] ?? key : key)}: ${rendered}`];
    });
    const events = groupElementInteractions(node, interactions, prefix);
    if (events.length || controls.length) {
      const listeners = events.map(({ event, handlers }, index) => ({ event, name: `${prefix}Listener${index}`, body: handlers.map(handler => `${handler}(event);`).join(' ') }));
      const syncControls = controls.length ? `const previous = ${prefix}ControlValues.get(element) ?? {}; ${controls.join(' ')} ${prefix}ControlValues.set(element, previous);` : '';
      attrs.push(`ref: (() => { let cleanup: (() => void) | undefined; return (element: HTMLElement | null): void => { cleanup?.(); cleanup = undefined; if (!element) return; ${syncControls} ${listeners.map(listener => `const ${listener.name} = (event: Event) => { ${listener.body} }; element.addEventListener(${json(listener.event)}, ${listener.name});`).join(' ')} cleanup = () => { ${listeners.map(listener => `element.removeEventListener(${json(listener.event)}, ${listener.name});`).join(' ')} }; }; })()`);
    }
    return `_uiCreateElement(${'tag' in node ? json(node.tag) : aliases.get(node.component)}, {${attrs.join(', ')}}${children.length ? `, ${children.join(', ')}` : ''})`;
  }
  const body = nodeCode(definition.root);
  const propTypes = ordered(definition.props).map(([key, prop]) => `  ${json(key)}${prop.required && prop.default === undefined ? '' : '?'}: ${prop.type};`).join('\n');
  return `import { createElement as _uiCreateElement, type ReactNode as _UiReactNode${usesStyle ? ', type CSSProperties as _UiCSSProperties' : ''}${mutatesState ? ', useState as _uiUseState, useRef as _uiUseRef' : ''} } from 'react';
${refs.map(id => `import ${aliases.get(id)} from ${json(`./${definitions.get(id)!.id}`)};`).join('\n')}
export interface ${className(definition)}Props {
${propTypes}${propTypes ? '\n' : ''}  children?: _UiReactNode;
}
${usesStyle ? reactStyleHelper : ''}
${usesControls ? `const ${prefix}ControlValues = new globalThis.WeakMap<HTMLElement, Record<string, unknown>>();\n` : ''}${usesAttributes ? `function attribute(value: unknown): string | undefined {\n  return value == null ? undefined : globalThis.String(value);\n}\n` : ''}
export default function ${className(definition)}(${usesProps ? 'input' : '_input'}: ${className(definition)}Props) {
${usesProps ? `  const props = { ...${json(defaults(definition))}, ...input };
${defaultAssignments(definition)}` : ''}${mutatesState ? `
  const [${state}, ${prefix}SetState] = _uiUseState<${stateType(definition)}>(() => (${json(stateDefaults(definition))}));
  const ${prefix}StateRef = _uiUseRef(${state});
` : usesState ? `
  const ${state}: ${stateType(definition)} = ${json(stateDefaults(definition))};
` : ''}${selectedInteractions.length ? `
${renderInteractionHandlers(definition, interactions, { typescript: true, prefix, stateScope: mutatesState ? `${prefix}StateRef.current` : state, commit: next => `${prefix}StateRef.current = { ...${next} }; ${prefix}SetState(${prefix}StateRef.current);` })}
` : ''}
  return ${body};
}
`;
}
