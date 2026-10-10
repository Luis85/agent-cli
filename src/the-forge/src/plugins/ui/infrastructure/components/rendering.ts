import type { UiDefinition, UiFramework, UiValue } from '../../domain/components/definition.ts';
import { uiBindingParts as pieces } from '../../domain/components/syntax.ts';

export const ordered = <T>(object: Record<string, T>) => Object.entries(object).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
export const json = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export const html = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const className = (definition: UiDefinition) => definition.name ?? definition.id.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join('');
export const defaults = (definition: UiDefinition): Record<string, UiValue> => Object.fromEntries(ordered(definition.props).filter(([, prop]) => prop.default !== undefined).map(([key, prop]) => [key, prop.default!]));

/** The importable artifact used by UI composition and Storybook. */
export function componentArtifact(definition: UiDefinition, framework: UiFramework) {
  const extension = { html: 'js', htmx: 'js', vanilla: 'js', react: 'tsx', vue: 'vue', svelte: 'svelte', angular: 'ts' }[framework];
  return { fileName: `${definition.id}.${extension}`, exportName: framework === 'angular' ? `${className(definition)}Component` : ['html', 'htmx', 'vanilla'].includes(framework) ? `create${className(definition)}` : className(definition), namedExport: framework === 'angular' };
}

export function expression(value: UiValue, scope = 'props', stateScope = '_uiState'): string {
  if (typeof value !== 'string') return json(value);
  const parts = pieces(value);
  const binding = (name: string) => name.startsWith('state.') ? `${stateScope}[${json(name.slice(6))}]` : `${scope}[${json(name)}]`;
  if (parts.length === 1 && 'prop' in parts[0]!) return binding(parts[0].prop);
  return parts.map(part => 'literal' in part ? json(part.literal) : `('' + (${binding(part.prop)} ?? ''))`).join(' + ');
}

export function evaluate(value: UiValue, props: Record<string, UiValue>, state: Record<string, UiValue> = {}): UiValue | undefined {
  if (typeof value !== 'string') return value;
  const parts = pieces(value);
  const binding = (name: string) => name.startsWith('state.') ? state[name.slice(6)] : props[name];
  if (parts.length === 1 && 'prop' in parts[0]!) return binding(parts[0].prop);
  return parts.map(part => 'literal' in part ? part.literal : String(binding(part.prop) ?? '')).join('');
}

export function textExpression(value: string, scope = 'props', stateScope = '_uiState'): string {
  const parts = pieces(value);
  const result = expression(value, scope, stateScope);
  return parts.length === 1 && 'prop' in parts[0]! ? `(${result} ?? '')` : result;
}

export function defaultAssignments(definition: UiDefinition): string {
  return ordered(definition.props).filter(([, prop]) => prop.default !== undefined).map(([key, prop]) => `  if (props[${json(key)}] === undefined) props[${json(key)}] = ${json(prop.default)};`).join('\n');
}
