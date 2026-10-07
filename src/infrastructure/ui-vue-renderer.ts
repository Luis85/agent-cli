import { componentDependencies } from '../domain/ui-library.ts';
import type { UiDefinition, UiNode } from '../domain/ui.ts';
import { uiVoidTags as voidTags } from '../domain/ui-syntax.ts';
import { ordered, html, expression, json } from './ui-rendering.ts';

export function vueModule(definition: UiDefinition, definitions: Map<string, UiDefinition>): string {
  const refs = componentDependencies(definition.root);
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
