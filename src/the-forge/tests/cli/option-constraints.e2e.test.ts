import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import type { CommandOption } from '../../src/application/plugins/command-metadata.ts';

/** The host enforces what `schema` publishes: every declared `enum` and `required` option, in every mode. */
const fixture = portableCli();
const cli = fixture.cli;

interface Contract { id: string; options: Record<string, CommandOption>; annotations: { actions?: Record<string, { options?: Record<string, CommandOption> }> } }
interface Mode { tokens: string[]; options: Record<string, CommandOption> }
let modes: Mode[];

/** A user plugin with a comma-separated list option that reports the value it receives. */
const lister = `export default { commands: [{
  id: 'lister.run', description: 'Report the kinds received', usage: 'lister.run [--kinds red,green]', mutating: false,
  options: { kinds: { type: 'string', description: 'Kinds.', enum: ['red', 'green'], list: true } },
  run(args, flags) { return { received: flags.kinds }; },
}] };
`;

beforeAll(async () => {
  await mkdir(join(fixture.project, 'bin/plugins/lister'), { recursive: true });
  await writeFile(join(fixture.project, 'bin/plugins/lister/manifest.json'), JSON.stringify({ id: 'lister', name: 'Lister', version: '1.0.0', minAppVersion: '0.1.0', description: 'List option fixture', author: 'Tests' }));
  await writeFile(join(fixture.project, 'bin/plugins/lister/main.mjs'), lister);
  await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['lister'] } }));
  const commands = (await cli(['schema', '--all'])).body.data.commands as Contract[];
  modes = commands.flatMap(command => [
    { tokens: [command.id], options: command.options },
    ...Object.entries(command.annotations.actions ?? {}).filter(([, action]) => action.options !== undefined)
      .map(([id, action]) => ({ tokens: [command.id, ...id.split(' ')], options: { ...command.options, ...action.options } })),
  ]);
});

/** Values for every required option except `omit`, so only the constraint under test can fail. */
const requiredValues = (options: Record<string, CommandOption>, omit?: string) => Object.entries(options)
  .filter(([key, schema]) => schema.required && key !== omit).flatMap(([key, schema]) => [`--${key}`, schema.enum?.[0] ?? 'value']);

/** The mode whose `tokens` an expectation names, such as `make ui`. */
const mode = (tokens: string) => modes.find(candidate => candidate.tokens.join(' ') === tokens)!;

/**
 * `option-constraints.integration.test.ts` checks every declared constraint of every mode in process; these
 * representative invocations, a command option and an action option each, confirm the CLI applies the same checks.
 */
describe('declared option constraints', () => {
  it('rejects a value outside a declared enum with INVALID_OPTION_VALUE', async () => {
    for (const [tokens, key] of [['list', 'kind'], ['make ui', 'framework']] as const) {
      const { options } = mode(tokens);
      const result = await cli([...tokens.split(' '), ...requiredValues(options, key), `--${key}`, 'not-a-declared-value']);
      expect(result.body.error, `${tokens} --${key}`).toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: key, value: 'not-a-declared-value', allowed: options[key]!.enum } });
    }
  });

  it('rejects an invocation without a declared required option with MISSING_ARGUMENT', async () => {
    for (const [tokens, key] of [['edit', 'if-match'], ['make document', 'template']] as const) {
      const result = await cli([...tokens.split(' '), ...requiredValues(mode(tokens).options, key)]);
      expect(result.body.error, `${tokens} --${key}`).toMatchObject({ code: 'MISSING_ARGUMENT', message: key === 'if-match' ? expect.stringMatching(/^--if-match is required: pass the current revision, data\.revision from read or stat/) : `--${key} is required.`, details: { option: key } });
    }
  });

  it('checks every item of a comma-separated list option and publishes the list as a pattern', async () => {
    expect((await cli(['create', 'notes/parts.md', '--content', '# Parts\n'])).status).toBe(0);
    for (const parts of ['body,body', 'body, body']) {
      const read = await cli(['read', 'notes/parts.md', '--parts', parts]);
      expect(read.body.error, parts).toBeUndefined();
      expect(read.body.data.document.body).toBeDefined();
    }
    expect((await cli(['read', 'notes/parts.md', '--parts', 'body,nope'])).body.error)
      .toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: 'parts', value: 'body,nope', allowed: ['content', 'properties', 'body'] } });
    const german = (await cli(['--lang', 'de', 'read', 'notes/parts.md', '--parts', 'body,nope'])).body.error;
    expect(german.message).toBe('--parts erlaubt "body,nope" nicht; gültige Werte (bei einer kommagetrennten Listenoption mehrere davon): content, properties, body.');
    expect(german.details.localization.originalMessage).toBe('--parts must be a comma-separated list of: content, properties, body.');
    const contract = (await cli(['schema', 'read'])).body.data.commands[0];
    expect(contract.options.parts).toMatchObject({ type: 'string', enum: ['content', 'properties', 'body'], list: true });
    const published = contract.inputSchema.properties.options.properties.parts as { enum?: string[]; pattern: string };
    expect(published.enum).toBeUndefined();
    expect(['body', 'body,body', 'body, body', ' body ,body '].map(value => new RegExp(published.pattern, 'u').test(value))).toEqual([true, true, true, true]);
    expect(['', 'nope', 'body,', 'body, ,body', 'body,nope'].some(value => new RegExp(published.pattern, 'u').test(value))).toBe(false);
  });

  it('hands a command each list item trimmed, joined by commas, for user plugins as for core commands', async () => {
    for (const [value, received] of [['red,green', 'red,green'], ['red, green', 'red,green'], [' green ,red ,green', 'green,red,green']] as const) {
      expect((await cli(['lister.run', '--kinds', value])).body.data, value).toEqual({ received });
    }
    expect((await cli(['lister.run', '--kinds', 'red, purple'])).body.error).toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: 'kinds', value: 'red, purple' } });
  });

  it('enforces the enum of the global --events option before and after the command', async () => {
    for (const tokens of [['--events', 'xx', 'list'], ['list', '--events', 'xx']]) {
      expect((await cli(tokens)).body.error, tokens.join(' ')).toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: 'events', value: 'xx', allowed: ['none', 'changes', 'all'] } });
    }
    // help describes a command without running it, so no declared value applies, the global --events included.
    for (const tokens of [['--events', 'xx', 'list', '--help'], ['list', '--events', 'xx', '--help'], ['--events', 'xx', '--help', 'list']]) {
      const help = await cli(tokens);
      expect(help.body.error, tokens.join(' ')).toBeUndefined();
      expect(help.body.data.id, tokens.join(' ')).toBe('list');
    }
  });

  it('describes the constraint in the response language and leaves help available', async () => {
    const german = await cli(['--lang', 'de', 'list', '--kind', 'note']);
    expect(german.body.error).toMatchObject({ code: 'INVALID_OPTION_VALUE', message: expect.stringMatching(/^--kind erlaubt "note" nicht; gültige Werte .*: /), details: { option: 'kind', localization: { originalMessage: expect.stringContaining('--kind must be one of') } } });
    expect((await cli(['edit', '--help'])).status).toBe(0);
  });
});
