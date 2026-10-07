import { componentDependencies } from '../domain/ui-library.ts';
import type { UiDefinition, UiNode } from '../domain/ui.ts';
import { uiBooleanAttributes as booleanAttrs } from '../domain/ui-syntax.ts';
import { ordered, textExpression, json, expression, defaults, defaultAssignments, className } from './ui-rendering.ts';
import { reactStyleHelper } from './ui-react-style.ts';

const reactNames: Record<string, string> = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', autofocus: 'autoFocus', autocomplete: 'autoComplete', colspan: 'colSpan', rowspan: 'rowSpan', maxlength: 'maxLength', minlength: 'minLength', contenteditable: 'contentEditable', spellcheck: 'spellCheck', srcset: 'srcSet', usemap: 'useMap', datetime: 'dateTime', crossorigin: 'crossOrigin', novalidate: 'noValidate', formnovalidate: 'formNoValidate', acceptcharset: 'acceptCharset', httpequiv: 'httpEquiv' };
export function reactModule(definition: UiDefinition, definitions: Map<string, UiDefinition>): string {
  const refs = componentDependencies(definition.root);
  const aliases = new Map(refs.map((id, index) => [id, `UiChild_${index}`]));
  let usesStyle = false;
  let usesAttributes = false;
  function nodeCode(node: UiNode): string {
    if ('slot' in node) return 'props.children';
    const children = (node.children ?? []).map(nodeCode);
    if ('tag' in node && node.text !== undefined) children.unshift(`globalThis.String(${textExpression(node.text)})`);
    const attrs = ordered('tag' in node ? node.attrs ?? {} : node.props ?? {}).map(([key, value]) => {
      const isStyle = 'tag' in node && key === 'style';
      if (isStyle) usesStyle = true;
      const isAttribute = 'tag' in node && !isStyle && !booleanAttrs.has(key.toLowerCase());
      if (isAttribute) usesAttributes = true;
      const rendered = isStyle ? `css(${expression(value)})` : isAttribute ? `attribute(${expression(value)})` : expression(value);
      return `${json('tag' in node ? reactNames[key] ?? key : key)}: ${rendered}`;
    });
    return `_uiCreateElement(${'tag' in node ? json(node.tag) : aliases.get(node.component)}, {${attrs.join(', ')}}${children.length ? `, ${children.join(', ')}` : ''})`;
  }
  const body = nodeCode(definition.root);
  const propTypes = ordered(definition.props).map(([key, prop]) => `  ${json(key)}${prop.required && prop.default === undefined ? '' : '?'}: ${prop.type};`).join('\n');
  return `import { createElement as _uiCreateElement, type ReactNode as _UiReactNode${usesStyle ? ', type CSSProperties as _UiCSSProperties' : ''} } from 'react';
${refs.map(id => `import ${aliases.get(id)} from ${json(`./${definitions.get(id)!.id}`)};`).join('\n')}
export interface ${className(definition)}Props {
${propTypes}${propTypes ? '\n' : ''}  children?: _UiReactNode;
}
${usesStyle ? reactStyleHelper : ''}
${usesAttributes ? `function attribute(value: unknown): string | undefined {\n  return value == null ? undefined : globalThis.String(value);\n}\n` : ''}
export default function ${className(definition)}(input: ${className(definition)}Props) {
  const props = { ...${json(defaults(definition))}, ...input };
${defaultAssignments(definition)}
  return ${body};
}
`;
}
