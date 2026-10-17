import type { InteractionDefinition } from '../../../domain/interactions/definition.ts';
import { componentInteractions, groupElementInteractions, interactionPrefix, renderInteractionHandlers, stateDefaults, stateType } from '../interactions/handlers.ts';
import { componentDependencies } from '../../../domain/components/library.ts';
import type { UiDefinition, UiNode } from '../../../domain/components/definition.ts';
import { uiVoidTags as voidTags } from '../../../domain/components/syntax.ts';
import { ordered, html, expression, json } from '../rendering.ts';
import { guardedUrl, guardsUrl, safeUrlHelper } from '../url-guard.ts';

export function vueModule(definition: UiDefinition, definitions: Map<string, UiDefinition>, interactions: readonly InteractionDefinition[] = []): string {
  const prefix = interactionPrefix(definition);
  const state = `${prefix}State`;
  const interactive = Object.keys(definition.state ?? {}).length > 0 || componentInteractions(definition, interactions).length > 0;
  const refs = componentDependencies(definition.root);
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  let urls = false;
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return '<slot />';
    const tag = 'tag' in node ? node.tag : aliases.get(node.component)!;
    if ('tag' in node) urls ||= Object.entries(node.attrs ?? {}).some(([key, value]) => guardsUrl(key, value));
    const attrs = ordered('tag' in node ? node.attrs ?? {} : node.props ?? {}).map(([key, value]) => {
      const rendered = expression(value, 'props', state);
      return ` :${key}="${html('tag' in node ? guardedUrl(key, value, rendered) : rendered)}"`;
    }).join('');
    const events = groupElementInteractions(node, interactions, prefix).map(({ event, handlers }) => ` @${event}="${html(handlers.map(handler => `${handler}($event)`).join('; '))}"`).join('');
    const text = 'tag' in node && node.text !== undefined ? `{{ ${html(expression(node.text, 'props', state))} }}` : '';
    return `<${tag}${attrs}${events}>${'tag' in node && voidTags.has(tag) ? '' : `${text}${(node.children ?? []).map(nodeCode).join('')}</${tag}>`}`;
  }
  const template = nodeCode(definition.root);
  return `<script setup lang="ts">${interactive ? `\nimport { reactive as _uiReactive } from 'vue';` : ''}
${refs.map(id => `import ${aliases.get(id)} from ${json(`./${definitions.get(id)!.id}.vue`)};`).join('\n')}
const props = defineProps({
${ordered(definition.props).map(([key, prop]) => `  ${json(key)}: { type: ${prop.type === 'string' ? 'String' : prop.type === 'number' ? 'Number' : 'Boolean'}, required: ${Boolean(prop.required && prop.default === undefined)}${prop.default !== undefined ? `, default: ${json(prop.default)}` : prop.type === 'boolean' ? ', default: undefined' : ''} },`).join('\n')}
});${urls ? `
${safeUrlHelper(true).trimEnd()}` : ''}${interactive ? `
const ${state} = _uiReactive<${stateType(definition)}>(${json(stateDefaults(definition))});
${renderInteractionHandlers(definition, interactions, { typescript: true, prefix, stateScope: state, commit: next => `globalThis.Object.assign(${state}, ${next});` })}
` : ''}
</script>

<template>
  ${template}
</template>
`;
}
