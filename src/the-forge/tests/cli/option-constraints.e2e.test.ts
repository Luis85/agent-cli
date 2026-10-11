import { beforeAll, describe, expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';
import type { CommandOption } from '../../src/application/plugins/command-metadata.ts';

/** The host enforces what `schema` publishes: every declared `enum` and `required` option, in every mode. */
const fixture = portableCli();
const cli = fixture.cli;

interface Contract { id: string; options: Record<string, CommandOption>; annotations: { actions?: Record<string, { options?: Record<string, CommandOption> }> } }
interface Mode { tokens: string[]; options: Record<string, CommandOption> }
let modes: Mode[];

beforeAll(async () => {
  const commands = (await cli(['schema'])).body.data.commands as Contract[];
  modes = commands.flatMap(command => [
    { tokens: [command.id], options: command.options },
    ...Object.entries(command.annotations.actions ?? {}).filter(([, action]) => action.options !== undefined)
      .map(([id, action]) => ({ tokens: [command.id, id], options: { ...command.options, ...action.options } })),
  ]);
});

/** Values for every required option except `omit`, so only the constraint under test can fail. */
const requiredValues = (options: Record<string, CommandOption>, omit?: string) => Object.entries(options)
  .filter(([key, schema]) => schema.required && key !== omit).flatMap(([key, schema]) => [`--${key}`, schema.enum?.[0] ?? 'value']);

describe('declared option constraints', () => {
  it('rejects a value outside every declared enum with INVALID_OPTION_VALUE', async () => {
    const checked: string[] = [];
    for (const { tokens, options } of modes) {
      for (const [key, schema] of Object.entries(options)) {
        if (schema.enum === undefined) continue;
        const result = await cli([...tokens, ...requiredValues(options), `--${key}`, 'not-a-declared-value']);
        expect(result.body.error, `${tokens.join(' ')} --${key}`).toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: key, value: 'not-a-declared-value', allowed: schema.enum } });
        checked.push(`${tokens.join(' ')} --${key}`);
      }
    }
    expect(checked).toEqual(expect.arrayContaining(['list --kind', 'create --encoding', 'make ui --framework', 'agents --mcp', 'backlog --direction', 'vault tags --sort']));
  });

  it('rejects an invocation without a declared required option with MISSING_ARGUMENT', async () => {
    const checked: string[] = [];
    for (const { tokens, options } of modes) {
      for (const [key, schema] of Object.entries(options)) {
        if (!schema.required) continue;
        const result = await cli([...tokens, ...requiredValues(options, key)]);
        expect(result.body.error, `${tokens.join(' ')} --${key}`).toMatchObject({ code: 'MISSING_ARGUMENT', message: `--${key} is required.`, details: { option: key } });
        checked.push(`${tokens.join(' ')} --${key}`);
      }
    }
    expect(checked).toEqual(expect.arrayContaining(['edit --if-match', 'patch --pointer', 'make document --template']));
  });

  it('checks every item of a comma-separated list option and publishes the list as a pattern', async () => {
    expect((await cli(['create', 'notes/parts.md', '--content', '# Parts\n'])).status).toBe(0);
    const read = await cli(['read', 'notes/parts.md', '--parts', 'body,body']);
    expect(read.body.error).toBeUndefined();
    expect(read.body.data.document.body).toBeDefined();
    expect((await cli(['read', 'notes/parts.md', '--parts', 'body,nope'])).body.error)
      .toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: 'parts', value: 'body,nope', allowed: ['body'] } });
    const contract = (await cli(['schema', 'read'])).body.data.commands[0];
    expect(contract.options.parts).toMatchObject({ type: 'string', enum: ['body'], list: true });
    const published = contract.inputSchema.properties.options.properties.parts as { enum?: string[]; pattern: string };
    expect(published.enum).toBeUndefined();
    expect(['body', 'body,body'].map(value => new RegExp(published.pattern, 'u').test(value))).toEqual([true, true]);
    expect(['', 'nope', 'body,', 'body,nope'].some(value => new RegExp(published.pattern, 'u').test(value))).toBe(false);
  });

  it('enforces the enum of the global --events option before and after the command', async () => {
    for (const tokens of [['--events', 'xx', 'list'], ['list', '--events', 'xx']]) {
      expect((await cli(tokens)).body.error, tokens.join(' ')).toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: 'events', value: 'xx', allowed: ['none', 'changes', 'all'] } });
    }
  });

  it('describes the constraint in the response language and leaves help available', async () => {
    const german = await cli(['--lang', 'de', 'list', '--kind', 'note']);
    expect(german.body.error).toMatchObject({ code: 'INVALID_OPTION_VALUE', message: expect.stringContaining('Optionswert'), details: { option: 'kind', localization: { originalMessage: expect.stringContaining('--kind must be one of') } } });
    expect((await cli(['edit', '--help'])).status).toBe(0);
  });
});
