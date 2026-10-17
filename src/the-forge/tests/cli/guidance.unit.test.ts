import { describe, expect, it } from 'vitest';
import { AppError, forgeError } from '../../src/domain/shared/errors.ts';
import { arity } from '../../src/application/plugins/command-input.ts';
import { runCommand, unknownOption, unknownOptionGuidance } from '../../src/presentation/cli/guidance.ts';
import { parseArguments } from '../../src/presentation/cli/arguments.ts';
import { globalOptions } from '../../src/application/plugins/command-input.ts';
import { guidedHint } from '../../src/presentation/localization/hints.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';
import type { Command, CommandContext } from '../../src/application/plugins/registry.ts';

const read: Command = {
  id: 'read', description: 'Read', usage: 'read <path> [--parts body]', mutating: false,
  args: [{ name: 'path', description: 'Path.', required: true }], options: { parts: { type: 'string', description: 'Parts.' } },
  run: args => { arity(args, 1); return null; },
};
const move: Command = {
  id: 'move', description: 'Move', usage: 'move <from> <to>', args: [{ name: 'from', description: 'From.' }, { name: 'to', description: 'To.' }],
  run: args => { arity(args, 2); return null; },
};
const backlog: Command = {
  id: 'backlog', description: 'Backlog', usage: 'backlog list | show <item>', unknownAction: 'INVALID_ARGUMENT',
  actions: { list: { description: 'List.' }, show: { description: 'Show.', usage: 'backlog show <item>' } },
  run: args => { arity(args.slice(1), args[0] === 'show' ? 1 : 0); return null; },
};
const plan: Command = {
  id: 'plan', description: 'Plan', usage: 'plan iteration add | iteration assign <item>', unknownAction: 'INVALID_ARGUMENT',
  actions: { 'iteration add': { description: 'Add.' }, 'iteration assign': { description: 'Assign.', usage: 'plan iteration assign <item>' } },
  run: args => { arity(args.slice(2), args[1] === 'assign' ? 1 : 0); return null; },
};
const context = {} as CommandContext;
const failure = async (command: Command, args: string[]) => {
  try { await runCommand(command, args, {}, context); }
  catch (error) { return error as AppError; }
  throw new Error('expected a failure');
};

describe('invocation guidance', () => {
  it('names the missing positional arguments and the usage of a command', async () => {
    expect(await failure(read, [])).toMatchObject({
      code: 'INVALID_ARGUMENT', message: 'Missing <path>. Expected 1 positional argument, got 0. Usage: read <path> [--parts body]',
      details: { minimum: 1, maximum: 1, received: 0, missing: ['path'] },
    });
    expect(await failure(move, ['a.md'])).toMatchObject({ message: 'Missing <to>. Expected 2 positional arguments, got 1. Usage: move <from> <to>', details: { missing: ['to'] } });
    expect(await failure(read, ['a.md', 'b.md'])).toMatchObject({ message: 'Expected 1 positional argument, got 2. Usage: read <path> [--parts body]', details: { minimum: 1, maximum: 1, received: 2 } });
  });

  it('names the action and its usage for a command with actions, and rejects unknown actions first', async () => {
    expect(await failure(backlog, ['show'])).toMatchObject({ message: 'backlog show: Expected 1 positional argument, got 0. Usage: backlog show <item>', details: { minimum: 1, maximum: 1, received: 0 } });
    expect(await failure(backlog, ['sho'])).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'Unknown backlog action sho. Actions: list, show.', details: { action: 'sho', allowed: ['list', 'show'], suggestions: ['show'] } });
  });

  it('names an action of several words, its usage and its options', async () => {
    expect(await failure(plan, ['iteration', 'assign'])).toMatchObject({ message: 'plan iteration assign: Expected 1 positional argument, got 0. Usage: plan iteration assign <item>' });
    expect(await failure(plan, ['iteration', 'asign'])).toMatchObject({ code: 'INVALID_ARGUMENT', details: { action: 'iteration asign', suggestions: ['iteration assign', 'iteration add'] } });
    expect(unknownOptionGuidance(unknownOption("unknown option '--goal'", []), plan, ['iteration', 'add'])).toMatchObject({ message: 'Unknown option --goal for plan iteration add.' });
  });

  it('leaves other failures unchanged', async () => {
    const other = forgeError('INVALID_ARGUMENT', 'Bad value.', { option: 'x' });
    expect(await failure({ ...read, run: () => { throw other; } }, ['a.md'])).toBe(other);
  });

  it('reports an unknown option with its name, the command and options the invocation accepts', () => {
    expect(() => parseArguments(['read', 'a.md', '--prts'], { ...globalOptions, parts: 'string' })).toThrow(expect.objectContaining({
      code: 'UNKNOWN_OPTION', message: 'Unknown option --prts.', details: { option: '--prts', suggestions: ['--parts'] },
    }));
    const error = unknownOption("error: unknown option '--verison'", Object.keys(globalOptions));
    expect(error.details).toEqual({ option: '--verison', suggestions: ['--version'] });
    // After a command, --version is not an option the invocation accepts.
    expect(unknownOptionGuidance(error, read, ['a.md'])).toMatchObject({
      code: 'UNKNOWN_OPTION', message: 'Unknown option --verison for read.', details: { option: '--verison', command: 'read', suggestions: [] },
    });
    expect(unknownOptionGuidance(unknownOption("error: unknown option '--dryrun=1'", []), read, [])).toMatchObject({ details: { option: '--dryrun', suggestions: ['--dry-run'] } });
    expect(unknownOptionGuidance(unknownOption("unknown option '--item'", []), backlog, ['show'])).toMatchObject({ message: 'Unknown option --item for backlog show.' });
    const other = forgeError('MISSING_ARGUMENT', '--find is required.');
    expect(unknownOptionGuidance(other, read, [])).toBe(other);
  });
});

describe('guided hints', () => {
  it('names the invoked command, or the command in the details, in place of the placeholder', () => {
    expect(guidedHint('Run help <command> for usage.', 'INVALID_ARGUMENT', undefined, 'en', 'read')).toBe('Run help read for usage.');
    expect(guidedHint('Run help <command> to list its options.', 'UNKNOWN_OPTION', { command: 'move' }, 'en')).toBe('Run help move to list its options.');
    expect(guidedHint('Run help <command> for usage.', 'INVALID_ARGUMENT', undefined, 'en')).toBe('Run help <command> for usage.');
    // An unknown command id is not the command to describe.
    expect(guidedHint('Run help <command>.', 'UNKNOWN_COMMAND', { command: 'lsit' }, 'en')).toBe('Run help <command>.');
  });

  it('starts with did-you-mean suggestions, or the force and copy explanations, in the response language', () => {
    expect(guidedHint('Run help.', 'UNKNOWN_COMMAND', { command: 'lsit', suggestions: ['list'] }, 'en')).toBe('Did you mean list? Run help.');
    expect(guidedHint('Run help.', 'UNKNOWN_COMMAND', { command: 'li', suggestions: ['list', 'links', 'lint'] }, 'en')).toBe('Did you mean list, links or lint? Run help.');
    expect(guidedHint('Hilfe.', 'UNKNOWN_COMMAND', { command: 'li', suggestions: ['list', 'links'] }, 'de')).toBe('Meinten Sie list oder links? Hilfe.');
    expect(guidedHint('Run help.', 'UNKNOWN_COMMAND', { command: 'zzz', suggestions: [] }, 'en')).toBe('Run help.');
    expect(guidedHint('Run help <command>.', 'UNKNOWN_OPTION', { option: '--force', command: 'delete', suggestions: ['--if-match'] }, 'en'))
      .toBe('There is no force option: pass --if-match <revision> with the file\'s current revision from read or stat. Run help delete.');
    expect(guidedHint('Hilfe.', 'UNKNOWN_OPTION', { option: '-y', suggestions: ['--if-match'] }, 'de')).toMatch(/^Es gibt keine Force-Option: .*--if-match <revision>/);
    expect(guidedHint('Run help.', 'UNKNOWN_COMMAND', { command: 'cp', suggestions: ['read', 'create'] }, 'en')).toBe('There is no copy command: read the source, then create the copy with its content. Run help.');
    // Other codes keep their own details, even under a suggestions key.
    expect(guidedHint('Fix it.', 'NOT_FOUND', { suggestions: ['a.md'] }, 'en')).toBe('Fix it.');
  });

  it('applies to English and German failures through the localizer', () => {
    const error = forgeError('UNKNOWN_COMMAND', 'Unknown command ls.', { command: 'ls', suggestions: ['list'] });
    expect(new Localizer('en').error(error).hint).toMatch(/^Did you mean list\? Run help or schema/);
    expect(new Localizer('de').error(error).hint).toMatch(/^Meinten Sie list\? /);
    expect(new Localizer('de', undefined, 'read').error(forgeError('INVALID_ARGUMENT', 'x')).hint).toContain('help read');
  });
});
