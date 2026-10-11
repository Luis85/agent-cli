import { json } from '../rendering.ts';

/**
 * Generated interaction code is typed either with TypeScript annotations or, for JavaScript targets, with JSDoc, so
 * a project that type-checks its JavaScript (`checkJs`) accepts it wherever it is placed.
 */

/** `value` as `type`: a TypeScript assertion, or a JSDoc cast in JavaScript. */
export const typedAs = (value: string, type: string, typescript: boolean) => (typescript ? `${value} as ${type}` : `/** @type {${type}} */ (${value})`);

/** A parameter list (names with their TypeScript types) and, for JavaScript, the JSDoc line that types it. */
export function typedParameters(parameters: ReadonlyArray<readonly [string, string]>, typescript: boolean): { list: string; jsdoc: string } {
  if (typescript) return { list: parameters.map(([name, type]) => `${name}: ${type}`).join(', '), jsdoc: '' };
  return { list: parameters.map(([name]) => name).join(', '), jsdoc: `/** ${parameters.map(([name, type]) => `@param {${type}} ${name}`).join(' ')} */\n` };
}

/**
 * Generated code that tells whether the string `value` holds a control character or one of `extra`, without a
 * control-character regular expression (which linters reject).
 */
export const unsafeCharacters = (value: string, extra: readonly string[]) => `globalThis.Array.from(${value}).some(character => character < ' '${extra.map(item => ` || character === ${json(item)}`).join('')})`;
