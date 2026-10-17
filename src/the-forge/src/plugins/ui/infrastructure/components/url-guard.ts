import type { UiValue } from '../../domain/components/definition.ts';
import { uiBindings, uiSafeUrlSchemes, uiUrlAttributes } from '../../domain/components/syntax.ts';
import { json } from './rendering.ts';

/** The generated runtime URL guard, named so it cannot clash with props, state or interaction helpers. */
export const safeUrl = '_uiSafeUrl';

/** Whether an element attribute takes a bound value the browser loads or navigates to, so it needs the guard. */
export const guardsUrl = (key: string, value: UiValue): boolean => uiUrlAttributes.has(key.toLowerCase()) && uiBindings(value).length > 0;

/** `rendered` (the attribute's value expression) through the guard when `key` and `value` need it. */
export const guardedUrl = (key: string, value: UiValue, rendered: string): string => (guardsUrl(key, value) ? `${safeUrl}(${rendered})` : rendered);

/**
 * The guard as generated source, typed for TypeScript or with JSDoc: it mirrors `uiSafeUrl` and returns undefined,
 * which every target renders as an absent attribute, for a value with any other scheme such as `javascript:`.
 */
export function safeUrlHelper(typescript: boolean): string {
  const signature = typescript ? `function ${safeUrl}(value: unknown): string | undefined {` : `/** @param {unknown} value @returns {string | undefined} */\nfunction ${safeUrl}(value) {`;
  return `${signature}
  if (value == null) return undefined;
  const text = globalThis.String(value);
  let start = 0;
  while (start < text.length && text.charCodeAt(start) <= 32) start++;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text.slice(start).replace(/[\\t\\n\\r]/g, ''))?.[1]?.toLowerCase();
  return scheme === undefined || ${json(uiSafeUrlSchemes)}.includes(scheme) ? text : undefined;
}
`;
}
