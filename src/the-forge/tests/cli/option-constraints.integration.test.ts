import { beforeAll, describe, expect, it } from 'vitest';
import { commandOptions, type CommandOption } from '../../src/application/plugins/command-metadata.ts';
import type { Registry } from '../../src/application/plugins/registry.ts';
import { declaredValues, parseCommand } from '../../src/presentation/cli/arguments.ts';
import { fullRegistry } from '../support/full-registry.ts';

/**
 * The host enforces what `schema` publishes: every declared `enum` and `required` option, in every mode of every
 * kernel and core plugin command, checked in process with the parsing and validation `src/main.ts` applies before a
 * command runs. `option-constraints.e2e.test.ts` confirms representative cases through the portable CLI.
 */
interface Mode { tokens: string[]; options: Record<string, CommandOption> }
let registry: Registry;
let modes: Mode[];

beforeAll(async () => {
  registry = await fullRegistry();
  modes = [...registry.commands.values()].flatMap(command => [
    { tokens: [command.id], options: command.options ?? {} },
    ...Object.entries(command.actions ?? {}).filter(([, action]) => action.options !== undefined)
      .map(([id, action]) => ({ tokens: [command.id, id], options: { ...command.options, ...action.options } })),
  ]);
});

/** Values for every required option except `omit`, so only the constraint under test can fail. */
const requiredValues = (options: Record<string, CommandOption>, omit?: string) => Object.entries(options)
  .filter(([key, schema]) => schema.required && key !== omit).flatMap(([key, schema]) => [`--${key}`, schema.enum?.[0] ?? 'value']);

/** The failure an invocation meets before its command runs, or undefined when it would run. */
function rejection(tokens: string[]): unknown {
  const command = registry.resolveCommand(tokens[0]!);
  try {
    const parsed = parseCommand(tokens, command);
    declaredValues(commandOptions(command, parsed.args.slice(1)), parsed.flags);
  } catch (error) { return error; }
  return undefined;
}

describe('declared option constraints of every mode', () => {
  it('rejects a value outside every declared enum with INVALID_OPTION_VALUE', () => {
    const checked: string[] = [];
    for (const { tokens, options } of modes) {
      for (const [key, schema] of Object.entries(options)) {
        if (schema.enum === undefined) continue;
        const error = rejection([...tokens, ...requiredValues(options), `--${key}`, 'not-a-declared-value']);
        expect(error, `${tokens.join(' ')} --${key}`).toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: key, value: 'not-a-declared-value', allowed: schema.enum } });
        checked.push(`${tokens.join(' ')} --${key}`);
      }
    }
    expect(checked).toEqual(expect.arrayContaining(['list --kind', 'create --encoding', 'make ui --framework', 'agents --mcp', 'backlog --direction', 'vault tags --sort']));
  });

  it('rejects an invocation without a declared required option with MISSING_ARGUMENT', () => {
    const checked: string[] = [];
    for (const { tokens, options } of modes) {
      for (const [key, schema] of Object.entries(options)) {
        if (!schema.required) continue;
        const error = rejection([...tokens, ...requiredValues(options, key)]);
        expect(error, `${tokens.join(' ')} --${key}`).toMatchObject({ code: 'MISSING_ARGUMENT', message: key === 'if-match' ? expect.stringMatching(/^--if-match is required: pass the current revision, data\.revision from read or stat/) : `--${key} is required.`, details: { option: key } });
        checked.push(`${tokens.join(' ')} --${key}`);
      }
    }
    expect(checked).toEqual(expect.arrayContaining(['edit --if-match', 'patch --pointer', 'make document --template']));
  });

  it('accepts every mode once its required options have declared values', () => {
    for (const { tokens, options } of modes) expect(rejection([...tokens, ...requiredValues(options)]), tokens.join(' ')).toBeUndefined();
  });
});
