import type { InteractionDefinition } from '../domain/interaction.ts';
import { componentInteractions, groupElementInteractions, interactionPrefix, renderInteractionHandlers, stateDefaults, stateType } from './ui-interaction-rendering.ts';
import { componentDependencies } from '../domain/ui-library.ts';
import type { UiDefinition, UiNode, UiValue } from '../domain/ui.ts';
import { uiVoidTags as voidTags } from '../domain/ui-syntax.ts';
import { expression, ordered, textExpression, json } from './ui-rendering.ts';

export function svelteModule(definition: UiDefinition, definitions: Map<string, UiDefinition>, interactions: readonly InteractionDefinition[] = []): string {
  const prefix = interactionPrefix(definition);
  const state = `${prefix}State`;
  const interactive = Object.keys(definition.state ?? {}).length > 0 || componentInteractions(definition, interactions).length > 0;
  const refs = componentDependencies(definition.root);
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  function svelteExpression(value: UiValue): string { return expression(value, '_uiProps', state); }
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return '<slot />';
    const tag = 'tag' in node ? node.tag : aliases.get(node.component)!;
    const attrs = ordered('tag' in node ? node.attrs ?? {} : node.props ?? {}).map(([key, value]) => ` ${key}={${svelteExpression(value)}}`).join('');
    const events = groupElementInteractions(node, interactions, prefix).map(({ event, handlers }) => ` on:${event}={(event) => { ${handlers.map(handler => `${handler}(event);`).join(' ')} }}`).join('');
    const text = 'tag' in node && node.text !== undefined ? `{${textExpression(node.text, '_uiProps', state)}}` : '';
    return `<${tag}${attrs}${events}>${'tag' in node && voidTags.has(tag) ? '' : `${text}${(node.children ?? []).map(nodeCode).join('')}</${tag}>`}`;
  }
  return `<script lang="ts">
${refs.map(id => `  import ${aliases.get(id)} from ${json(`./${definitions.get(id)!.id}.svelte`)};`).join('\n')}
${ordered(definition.props).map(([key, prop], index) => `  let _uiProp${index}: ${prop.type}${prop.required || prop.default !== undefined ? '' : ' | undefined'}${prop.default !== undefined ? ` = ${json(prop.default)}` : prop.required ? '' : ' = undefined'};\n  export { _uiProp${index} as ${key} };`).join('\n')}
  $: _uiProps = {${ordered(definition.props).map(([key], index) => `${json(key)}: _uiProp${index}`).join(', ')}};${interactive ? `
  let ${state}: ${stateType(definition)} = ${json(stateDefaults(definition))};
${renderInteractionHandlers(definition, interactions, { typescript: true, prefix, propsScope: '_uiProps', stateScope: state, commit: next => `${state} = { ...${next} };` })}
` : ''}
</script>

${nodeCode(definition.root)}
`;
}
