import type { UiDefinition } from '../../../domain/components/definition.ts';
import { className, componentArtifact, json, ordered, propsWithDefaults } from '../rendering.ts';

/**
 * The parts the static and the live DOM factory share. Both are JavaScript typed through JSDoc, matching the `.d.ts`
 * declaration written beside them, so a project that type-checks its JavaScript (`checkJs`) and lints it accepts the
 * output wherever it is placed. Helpers and parameters a component does not use are left out or named with a leading
 * underscore.
 */

const requiredProp = (prop: UiDefinition['props'][string]) => prop.required === true && prop.default === undefined;
const hasRequiredProps = (definition: UiDefinition) => Object.values(definition.props).some(requiredProp);
/** The props type as TypeScript source: required props without a default are required, the rest optional. */
const propsType = (definition: UiDefinition) => `{ ${ordered(definition.props).map(([key, prop]) => `${json(key)}${requiredProp(prop) ? '' : '?'}: ${prop.type}`).join('; ')} }`;
const childrenType = 'readonly (Node | string | null | undefined)[]';

/** The JSDoc types of a factory module: its children and its props. */
export function domTypedefs(definition: UiDefinition): string {
  return `/** @typedef {${childrenType}} DomChildren */\n/** @typedef {${propsType(definition)}} Props */\n`;
}

/** Projects `children` into a fragment in order, skipping empty entries. */
export const domSlot = `/** @param {DomChildren} children */
function slot(children) {
  const fragment = document.createDocumentFragment();
  for (const child of children) if (child != null) fragment.append(child);
  return fragment;
}
`;

/** The factory's JSDoc and signature, naming a parameter it does not read with a leading underscore. */
export function domFactory(definition: UiDefinition, summary: string, uses: { props: boolean; children: boolean }): string {
  const required = hasRequiredProps(definition);
  const input = uses.props ? 'input' : '_input', children = uses.children ? 'children' : '_children';
  return `/**
 * ${summary}
 * @param {Props} ${required ? input : `[${input}]`} @param {DomChildren} [${children}] @returns {HTMLElement | DocumentFragment}
 */
export default function ${componentArtifact(definition, 'html').exportName}(${required ? input : `${input} = {}`}, ${children} = []) {`;
}

/** `props`: the defaults overridden by `input`, typed as the props. */
export function domProps(definition: UiDefinition): string {
  return `  /** @type {Props} */\n  const props = ${propsWithDefaults(definition)};\n`;
}

export function domDeclaration(definition: UiDefinition): string {
  return `export interface ${className(definition)}Props {\n${ordered(definition.props).map(([key, prop]) => `  ${json(key)}${requiredProp(prop) ? '' : '?'}: ${prop.type};`).join('\n')}\n}\n\nexport default function ${componentArtifact(definition, 'html').exportName}(input${hasRequiredProps(definition) ? '' : '?'}: ${className(definition)}Props, children?: ${childrenType}): HTMLElement | DocumentFragment;\n`;
}
