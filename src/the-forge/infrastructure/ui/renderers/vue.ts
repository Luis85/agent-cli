import type { InteractionDefinition } from '../../../domain/interactions/definition.ts';
import { componentInteractions, groupElementInteractions, interactionPrefix, renderInteractionHandlers, stateDefaults, stateType } from '../interactions/handlers.ts';
import { componentDependencies } from '../../../domain/ui/library.ts';
import type { UiDefinition, UiNode } from '../../../domain/ui/definition.ts';
import { uiVoidTags as voidTags } from '../../../domain/ui/syntax.ts';
import { ordered, html, expression, json } from '../rendering.ts';

export function vueModule(definition: UiDefinition, definitions: Map<string, UiDefinition>, interactions: readonly InteractionDefinition[] = []): string {
  const prefix = interactionPrefix(definition);
  const state = `${prefix}State`;
  const interactive = Object.keys(definition.state ?? {}).length > 0 || componentInteractions(definition, interactions).length > 0;
  const refs = componentDependencies(definition.root);
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return '<slot />';
    const tag = 'tag' in node ? node.tag : aliases.get(node.component)!;
    const attrs = ordered('tag' in node ? node.attrs ?? {} : node.props ?? {}).map(([key, value]) => ` :${key}="${html(expression(value, 'props', state))}"`).join('');
    const events = groupElementInteractions(node, interactions, prefix).map(({ event, handlers }) => ` @${event}="${html(handlers.map(handler => `${handler}($event)`).join('; '))}"`).join('');
    const text = 'tag' in node && node.text !== undefined ? `{{ ${html(expression(node.text, 'props', state))} }}` : '';
    return `<${tag}${attrs}${events}>${'tag' in node && voidTags.has(tag) ? '' : `${text}${(node.children ?? []).map(nodeCode).join('')}</${tag}>`}`;
  }
  return `<script setup lang="ts">${interactive ? `\nimport { reactive as _uiReactive } from 'vue';` : ''}
${refs.map(id => `import ${aliases.get(id)} from ${json(`./${definitions.get(id)!.id}.vue`)};`).join('\n')}
const props = defineProps({
${ordered(definition.props).map(([key, prop]) => `  ${json(key)}: { type: ${prop.type === 'string' ? 'String' : prop.type === 'number' ? 'Number' : 'Boolean'}, required: ${Boolean(prop.required && prop.default === undefined)}${prop.default !== undefined ? `, default: ${json(prop.default)}` : prop.type === 'boolean' ? ', default: undefined' : ''} },`).join('\n')}
});${interactive ? `
const ${state} = _uiReactive<${stateType(definition)}>(${json(stateDefaults(definition))});
${renderInteractionHandlers(definition, interactions, { typescript: true, prefix, stateScope: state, commit: next => `globalThis.Object.assign(${state}, ${next});` })}
` : ''}
</script>

<template>
  ${nodeCode(definition.root)}
</template>
`;
}
