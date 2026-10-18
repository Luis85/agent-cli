import { beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/shared/errors.ts';
import { ensureArguments } from '../../src/application/plugins/command-arguments.ts';
import { actionWords, argumentBounds, commandInputSchema, declaredArguments } from '../../src/application/plugins/command-metadata.ts';
import type { JsonSchema } from '../../src/domain/schema/json-schema.ts';
import type { Command, Registry } from '../../src/application/plugins/registry.ts';
import { fullRegistry } from '../support/full-registry.ts';

/**
 * The positional-argument contract of every bundled command and action: each declares its arguments, the host
 * enforces the bounds they imply before the command runs, and `schema` publishes the same bounds as the
 * `minItems` and `maxItems` of the invocation it describes.
 */
let registry: Registry;
beforeAll(async () => { registry = await fullRegistry(); });

/** The code `ensureArguments` fails with, or `null` when the invocation passes. */
function code(command: Command, args: readonly string[]): string | null {
  try { ensureArguments(command, args); return null; }
  catch (error) { return error instanceof AppError ? error.code : String(error); }
}
const filler = (count: number) => Array.from({ length: Math.max(count, 0) }, (_, index) => `value-${index}`);
/** The `args` schema of one published invocation shape: the branch titled `title`, or the schema itself. */
function argsSchema(schema: JsonSchema, title: string): JsonSchema | undefined {
  const shape = schema.oneOf ? schema.oneOf.find(branch => branch.title === title) : schema;
  return shape?.properties?.args;
}
/** Every invocation shape of the registry: each command without actions, and each action with its words. */
function shapes(): Array<{ command: Command; title: string; words: string[] }> {
  return [...registry.commands.values()].flatMap(command => command.actions
    ? Object.keys(command.actions).map(id => ({ command, title: `${command.id} ${id}`, words: actionWords(id) }))
    : [{ command, title: command.id, words: [] }]);
}

describe('declared positional arguments of the bundled commands', () => {
  it('declares the arguments of every command without actions and of every action', () => {
    const undeclared = shapes().filter(({ command, words }) => (words.length === 0 ? command.args : command.actions?.[words.join(' ')]?.args) === undefined).map(shape => shape.title);
    expect(undeclared).toEqual([]);
    expect(shapes().length).toBeGreaterThan(150);
  });

  it('enforces the declared bounds and publishes them as minItems and maxItems', () => {
    const mismatches: string[] = [];
    for (const { command, title, words } of shapes()) {
      const { minimum, maximum } = argumentBounds(declaredArguments(command, words)!);
      const fits = [...words, ...filler(minimum - words.length)];
      const check = (args: readonly string[], wanted: string | null) => { const got = code(command, args); if (got !== wanted) mismatches.push(`${title} [${args.join(' ')}]: ${got} instead of ${wanted}`); };
      check(fits, null);
      if (minimum > words.length) check(fits.slice(0, -1), 'MISSING_ARGUMENT');
      if (maximum !== undefined) check([...words, ...filler(maximum - words.length + 1)], 'INVALID_ARGUMENT');
      const published = argsSchema(commandInputSchema(command), title);
      if (published?.minItems !== minimum || published.maxItems !== maximum) mismatches.push(`${title}: schema ${published?.minItems}..${published?.maxItems} instead of ${minimum}..${maximum}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('requires an action where a command declares no default action and a required action argument', () => {
    for (const command of registry.commands.values()) {
      if (!command.actions) continue;
      const required = command.args?.some(arg => arg.required) === true;
      expect(code(command, []), command.id).toBe(required ? 'MISSING_ARGUMENT' : null);
      expect(commandInputSchema(command).oneOf!.some(branch => branch.properties?.args?.maxItems === 0), command.id).toBe(!required);
    }
  });
});
