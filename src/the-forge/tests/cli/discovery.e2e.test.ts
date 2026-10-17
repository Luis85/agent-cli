import { describe, expect, it } from 'vitest';
import { portableCli } from '../support/portable-cli.ts';

const { cli } = portableCli();
// Each workflow spawns several CLI processes; allow for slow shared CI hosts.
const workflowTimeout = 30000;

describe('discovery for agents without prior knowledge', () => {
  it('answers no arguments, help, --help and -h with the same compact index', async () => {
    const results = await Promise.all([[], ['help'], ['--help'], ['-h']].map(args => cli(args)));
    const index = results[0]!;
    expect(index.status).toBe(0);
    expect(Object.keys(index.body.data)).toEqual(['name', 'version', 'apiVersion', 'commands', 'mutating', 'globalOptions', 'next']);
    for (const result of results) expect(result.body.data).toEqual(index.body.data);
    const { commands, mutating, globalOptions, next } = index.body.data;
    expect(commands.read).toMatch(/revision/);
    expect(Object.keys(commands)).toEqual(expect.arrayContaining(['list', 'read', 'search', 'edit', 'apply', 'backlog']));
    expect(mutating).toEqual(expect.arrayContaining(['write', 'edit', 'move', 'delete', 'apply']));
    expect(mutating).not.toContain('read');
    expect(globalOptions).toEqual(expect.arrayContaining(['--root', '--json', '--dry-run', '--version']));
    expect(next).toMatch(/help <command>.*schema <command>/);
    // The indented index stays a small fraction of the full catalog.
    expect(index.stdout.length).toBeLessThan(6500);
    expect((await cli(['schema'])).stdout.length).toBeGreaterThan(index.stdout.length * 20);
    expect((await cli(['help', '--lang', 'de'])).body.data.next).toMatch(/^Verwendung, Optionen/);
  }, workflowTimeout);

  it('shows examples of the core document commands in their help', async () => {
    for (const id of ['read', 'read-many', 'list', 'search', 'create', 'write', 'edit', 'properties', 'move', 'rename', 'delete', 'apply', 'stat']) {
      const { examples } = (await cli(['help', id])).body.data;
      expect(examples.length, id).toBeGreaterThanOrEqual(1);
      expect(examples.length, id).toBeLessThanOrEqual(3);
      for (const example of examples) expect(example.startsWith(`${id} `), example).toBe(true);
    }
    expect((await cli(['help', 'formats'])).body.data).not.toHaveProperty('examples');
  }, workflowTimeout * 2);

  it('suggests commands for typos and other CLI habits', async () => {
    for (const [id, suggestions] of [['ls', ['list']], ['cat', ['read']], ['grep', ['search']], ['mv', ['move']], ['rm', ['delete']], ['serach', ['search']], ['version', ['--version']]] as const) {
      const result = await cli([id, 'x']);
      expect(result.status, id).toBe(2);
      expect(result.body.error, id).toMatchObject({ code: 'UNKNOWN_COMMAND', details: { command: id, suggestions }, hint: expect.stringMatching(/^Did you mean /) });
    }
  }, workflowTimeout);

  it('suggests only options the command accepts and explains the revision guard for --force', async () => {
    const section = await cli(['read', 'x.md', '--section', 'Plan']);
    expect(section.body.error).toEqual({
      code: 'UNKNOWN_OPTION', message: 'Unknown option --section for read.', hint: 'Run help read to list its options.', retryable: false,
      details: { option: '--section', command: 'read', suggestions: [] },
    });
    expect((await cli(['read', 'x.md', '--prts', 'body'])).body.error.details.suggestions).toEqual(['--parts']);
    expect((await cli(['list', '--preview'])).body.error.details.suggestions).toEqual(['--dry-run']);
    const force = await cli(['delete', 'x.md', '--force']);
    expect(force.body.error).toMatchObject({ code: 'UNKNOWN_OPTION', details: { option: '--force', command: 'delete', suggestions: ['--if-match'] } });
    expect(force.body.error.hint).toMatch(/^There is no force option: pass --if-match <revision>.* Run help delete/);
    const german = await cli(['--lang', 'de', 'delete', 'x.md', '-y']);
    expect(german.body.error.hint).toMatch(/^Es gibt keine Force-Option.* help delete/);
    expect((await cli(['--verison'])).body.error.details).toEqual({ option: '--verison', suggestions: ['--version'] });
  }, workflowTimeout);

  it('names missing arguments, unknown generators and actions, and the edit modes', async () => {
    const missing = await cli(['read']);
    expect(missing.body.error).toMatchObject({
      code: 'INVALID_ARGUMENT', message: expect.stringMatching(/^Missing <path>\. Expected 1 positional argument, got 0\. Usage: read <path>/),
      hint: expect.stringContaining('run help read for usage'), details: { minimum: 1, maximum: 1, received: 0, missing: ['path'] },
    });
    expect((await cli(['move', 'a.md'])).body.error.details.missing).toEqual(['to']);
    const generator = await cli(['make', 'entiy']);
    expect(generator.body.error).toMatchObject({ code: 'UNKNOWN_GENERATOR', message: expect.stringMatching(/^Unknown generator entiy\. Generators: .*entity/), details: { generator: 'entiy', suggestions: ['entity'] } });
    expect(generator.body.error.details.allowed).toContain('document');
    const action = await cli(['vault', 'chek']);
    expect(action.body.error).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'Unknown vault action chek. Actions: check, tags, properties.', details: { suggestions: ['check'] } });
    expect((await cli(['create', 'plan.md'])).status).toBe(0);
    const revision = (await cli(['read', 'plan.md'])).body.data.revision as string;
    const modes = await cli(['edit', 'plan.md', '--if-match', revision]);
    expect(modes.body.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/^Choose an edit mode: --find text --replace text, --edits/), details: { modes: ['find', 'edits', 'append', 'section', 'block'] } });
    expect((await cli(['edit', 'plan.md', '--if-match', revision, '--replace', 'x'])).body.error).toMatchObject({ code: 'MISSING_ARGUMENT', message: '--find is required.' });
  }, workflowTimeout);
});
