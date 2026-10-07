import { componentDependencies } from '../domain/ui-library.ts';
import type { UiDefinition, UiNode, UiValue } from '../domain/ui.ts';
import { uiVoidTags as voidTags } from '../domain/ui-syntax.ts';
import { expression, ordered, textExpression, json } from './ui-rendering.ts';

export function svelteModule(definition: UiDefinition, definitions: Map<string, UiDefinition>): string {
  const refs = componentDependencies(definition.root);
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
