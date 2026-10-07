import { ensure } from './errors.ts';
import type { UiValue } from './ui.ts';

export const interactionEvents = ['click', 'dblclick', 'input', 'change', 'submit', 'keydown', 'keyup', 'focus', 'blur'] as const;
/** React maps focus/blur to the bubbling native focusin/focusout events. */
export const interactionTriggerEvents: ReadonlySet<string> = new Set([...interactionEvents, 'focusin', 'focusout']);
export type InteractionEvent = typeof interactionEvents[number];
export type InteractionAction =
  | { type: 'set-state'; state: string; value: UiValue }
  | { type: 'set-state'; state: string; fromEvent: 'value' | 'checked' }
  | { type: 'toggle-state'; state: string }
  | { type: 'navigate'; url: string }
  | { type: 'emit'; event: string; detail?: Record<string, UiValue> };
export interface InteractionDefinition {
  schemaVersion: 1;
  id: string;
  event: InteractionEvent;
  keys?: string[];
  preventDefault?: boolean;
  stopPropagation?: boolean;
  actions: InteractionAction[];
  description: string;
  sourcePath: string;
}

export function validateInteractionLibrary(definitions: readonly InteractionDefinition[]): void {
  const ids = new Set<string>();
  for (const definition of definitions) {
    ensure(!ids.has(definition.id), 'DUPLICATE_INTERACTION', `Duplicate interaction ${definition.id}.`);
    ids.add(definition.id);
  }
}

/** Navigation never evaluates code or accepts protocol-relative destinations. */
export function isSafeNavigationUrl(value: string): boolean {
  if (!value || value !== value.trim() || [...value].some(character => character.charCodeAt(0) < 32 || character === '\\') || value.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value, 'https://forge.invalid/');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
