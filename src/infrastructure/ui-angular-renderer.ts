import type { InteractionDefinition } from '../domain/interaction.ts';
import { componentInteractions, groupElementInteractions, interactionPrefix, renderInteractionHandlers, stateDefaults, stateType } from './ui-interaction-rendering.ts';
import { componentDependencies } from '../domain/ui-library.ts';
import type { UiDefinition, UiNode, UiValue } from '../domain/ui.ts';
import { uiVoidTags as voidTags, uiBooleanAttributes as booleanAttrs, uiBindingParts as pieces } from '../domain/ui-syntax.ts';
import { json, ordered, html, componentArtifact } from './ui-rendering.ts';

export function angularModule(definition: UiDefinition, definitions: Map<string, UiDefinition>, interactions: readonly InteractionDefinition[] = []): string {
  const prefix = interactionPrefix(definition);
  const state = `${prefix}State`;
  const interactive = Object.keys(definition.state ?? {}).length > 0 || componentInteractions(definition, interactions).length > 0;
  const refs = componentDependencies(definition.root);
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  function angularExpression(value: UiValue): string {
    if (typeof value !== 'string') return json(value);
    const parts = pieces(value);
    const binding = (name: string) => name.startsWith('state.') ? `${state}[${json(name.slice(6))}]` : name;
    if (parts.length === 1 && 'prop' in parts[0]!) return binding(parts[0].prop);
    return parts.map(part => 'literal' in part ? json(part.literal) : `('' + (${binding(part.prop)} ?? ''))`).join(' + ');
  }
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return '<ng-content></ng-content>';
    const tag = 'tag' in node ? node.tag : `ui-${node.component}`;
    const attrs = ordered('tag' in node ? node.attrs ?? {} : node.props ?? {}).map(([key, value]) => {
      const expr = angularExpression(value);
      const property = interactive && 'tag' in node && ((key === 'value' && ['input', 'textarea', 'select', 'option'].includes(node.tag)) || (key === 'checked' && node.tag === 'input') || (key === 'selected' && node.tag === 'option'));
      const propertyValue = property ? key === 'value' ? `$any(${expr}) ?? ''` : `$any(${expr}) != null && $any(${expr}) !== false` : expr;
      return ` [${'tag' in node && !property ? `attr.${key}` : key}]="${html('tag' in node && !property && booleanAttrs.has(key.toLowerCase()) ? `$any(${expr}) === true ? '' : ($any(${expr}) === false ? null : (${expr}))` : propertyValue)}"`;
    }).join('');
    const events = groupElementInteractions(node, interactions, prefix).map(({ event, handlers }) => ` (${event})="${html(handlers.map(handler => `${handler}($event)`).join('; '))}"`).join('');
    const text = 'tag' in node && node.text !== undefined ? `{{ ${html(angularExpression(node.text))} }}` : '';
    return `<${tag}${attrs}${events}>${'tag' in node && voidTags.has(tag) ? '' : `${text}${(node.children ?? []).map(nodeCode).join('')}</${tag}>`}`;
  }
  return `import { Component${Object.keys(definition.props).length ? ', Input' : ''} } from '@angular/core';
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
}).join('\n')}${interactive ? `
  ${state}: ${stateType(definition)} = ${json(stateDefaults(definition))};
${renderInteractionHandlers(definition, interactions, { typescript: true, classMembers: true, prefix, propsScope: 'this', stateScope: `this.${state}`, commit: next => `this.${state} = { ...${next} };` })}
` : ''}
}
`;
}
