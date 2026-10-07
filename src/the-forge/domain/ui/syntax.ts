import { ensure } from '../shared/errors.ts';
import type { UiDefinition, UiProp, UiState, UiValue } from './definition.ts';

/** HTML semantics and prop syntax shared by validation and every target renderer. */
export const uiVoidTags: ReadonlySet<string> = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
export const uiBooleanAttributes: ReadonlySet<string> = new Set('allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ismap itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'.split(' '));
export type UiBindingPart = { literal: string } | { prop: string };

export function uiBindingParts(value: string): UiBindingPart[] {
  const parts: UiBindingPart[] = [];
  let last = 0;
  for (const match of value.matchAll(/\{\{\s*((?:state\.)?[A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
    if (match.index > last) parts.push({ literal: value.slice(last, match.index) });
    parts.push({ prop: match[1]! });
    last = match.index + match[0].length;
  }
  if (last < value.length || !parts.length) parts.push({ literal: value.slice(last) });
  return parts;
}

export function uiBindings(value: UiValue): string[] {
  return typeof value === 'string' ? uiBindingParts(value).flatMap(part => 'prop' in part ? [part.prop] : []) : [];
}

export function uiWholeBinding(value: UiValue): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = uiBindingParts(value);
  return parts.length === 1 && 'prop' in parts[0]! ? parts[0].prop : undefined;
}

export function uiHasMalformedBinding(value: UiValue): boolean {
  return typeof value === 'string' && uiBindingParts(value).some(part => 'literal' in part && /\{\{|\}\}/.test(part.literal));
}

export function uiBindingSource(definition: UiDefinition, name: string): UiProp | UiState | undefined {
  const fields = name.startsWith('state.') ? definition.state ?? {} : definition.props;
  const key = name.startsWith('state.') ? name.slice(6) : name;
  return Object.hasOwn(fields, key) ? fields[key] : undefined;
}

/** Bindings are references to declared scalar fields, never executable expressions. */
export function validateUiBindings(definition: UiDefinition, value: UiValue): void {
  for (const name of uiBindings(value)) ensure(uiBindingSource(definition, name), 'INVALID_UI', `${definition.id} binds unknown field ${name}.`);
  ensure(!uiHasMalformedBinding(value), 'INVALID_UI', `${definition.id} contains a malformed binding.`);
}
