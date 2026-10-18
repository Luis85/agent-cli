import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/shared/errors.ts';
import { ensureArguments } from '../../src/application/plugins/command-arguments.ts';
import { argumentBounds, commandInputSchema, declaredArguments, validateCommandMetadata, type CommandMetadata } from '../../src/application/plugins/command-metadata.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';
import { Localizer } from '../../src/presentation/localization/localization.ts';

const read: CommandMetadata = { id: 'read', description: 'Read', usage: 'read <path> [--parts body]', args: [{ name: 'path', description: 'Path.', required: true }] };
const move: CommandMetadata = { id: 'move', description: 'Move', usage: 'move <from> <to>', args: [{ name: 'from', description: 'From.', required: true }, { name: 'to', description: 'To.', required: true }] };
const many: CommandMetadata = { id: 'many', description: 'Many', usage: 'many <paths...>', args: [{ name: 'paths', description: 'Paths.', required: true, variadic: true, maximum: 3 }] };
const tags: CommandMetadata = { id: 'tags', description: 'Tags', usage: 'tags [tag...]', args: [{ name: 'tag', description: 'Tag.', variadic: true }] };
const backlog: CommandMetadata = {
  id: 'backlog', description: 'Backlog', usage: 'backlog list | show <item> | sync [status] | iteration assign <item> <iteration>', unknownAction: 'INVALID_ARGUMENT',
  args: [{ name: 'action', description: 'The action.', required: true }],
  actions: {
    list: { description: 'List.', args: [] },
    show: { description: 'Show.', usage: 'backlog show <item>', args: [{ name: 'item', description: 'Item.', required: true }] },
    sync: { description: 'Sync.', args: [], options: { direction: { type: 'string', description: 'Direction.', enum: ['push', 'pull'] } } },
    'sync status': { description: 'Status.', args: [] },
    'iteration assign': { description: 'Assign.', args: [{ name: 'item', description: 'Item.', required: true }, { name: 'iteration', description: 'Iteration.', required: true }] },
  },
};
/** A plugin command without declarations: the host checks nothing about its arguments. */
const free: CommandMetadata = { id: 'free', description: 'Free', usage: 'free [anything]', actions: { go: { description: 'Go.' } } };

function failure(command: CommandMetadata, args: string[]): AppError {
  try { ensureArguments(command, args); }
  catch (error) { return error as AppError; }
  throw new Error('expected a failure');
}

describe('declared positional arguments', () => {
  it('reports missing arguments with MISSING_ARGUMENT naming them and the usage', () => {
    expect(failure(read, [])).toMatchObject({
      code: 'MISSING_ARGUMENT', message: 'Missing <path>. Expected 1 positional argument, got 0. Usage: read <path> [--parts body]',
      details: { argument: 'path', missing: ['path'], command: 'read', minimum: 1, maximum: 1, received: 0 },
    });
    expect(failure(move, [])).toMatchObject({ message: 'Missing <from> <to>. Expected 2 positional arguments, got 0. Usage: move <from> <to>', details: { argument: 'from', missing: ['from', 'to'] } });
    expect(failure(many, [])).toMatchObject({ code: 'MISSING_ARGUMENT', message: 'Missing <paths>. Expected 1–3 positional arguments, got 0. Usage: many <paths...>' });
  });

  it('reports surplus arguments with INVALID_ARGUMENT quoting them', () => {
    expect(failure(read, ['a.md', 'b c.md'])).toMatchObject({
      code: 'INVALID_ARGUMENT', message: 'Unexpected "b c.md". Expected 1 positional argument, got 2. Usage: read <path> [--parts body]',
      details: { unexpected: ['b c.md'], command: 'read', minimum: 1, maximum: 1, received: 2 },
    });
    expect(failure(many, ['a', 'b', 'c', 'd', 'e'])).toMatchObject({ code: 'INVALID_ARGUMENT', details: { unexpected: ['d', 'e'], minimum: 1, maximum: 3, received: 5 } });
    expect(() => ensureArguments(many, ['a', 'b', 'c'])).not.toThrow();
    expect(() => ensureArguments(tags, [])).not.toThrow();
    expect(() => ensureArguments(tags, Array.from({ length: 50 }, (_, index) => `t${index}`))).not.toThrow();
  });

  it('counts an action\'s words with its own arguments and names the action and its usage', () => {
    expect(failure(backlog, ['show'])).toMatchObject({
      code: 'MISSING_ARGUMENT', message: 'backlog show: Missing <item>. Expected 2 positional arguments, got 1. Usage: backlog show <item>',
      details: { command: 'backlog', action: 'show', argument: 'item', minimum: 2, maximum: 2, received: 1 },
    });
    expect(failure(backlog, ['iteration', 'assign', 'A'])).toMatchObject({
      message: 'backlog iteration assign: Missing <iteration>. Expected 4 positional arguments, got 3. Usage: backlog iteration assign <item> <iteration>',
    });
    expect(failure(backlog, ['list', 'extra'])).toMatchObject({ code: 'INVALID_ARGUMENT', details: { action: 'list', unexpected: ['extra'], maximum: 1 } });
    expect(failure(backlog, [])).toMatchObject({ code: 'MISSING_ARGUMENT', details: { argument: 'action' } });
    expect(() => ensureArguments(backlog, ['sync', 'status'])).not.toThrow();
  });

  it('derives the usage of an action without one from its words, arguments and options', () => {
    expect(failure(backlog, ['sync', 'status', 'x']).message).toBe('backlog sync status: Unexpected "x". Expected 2 positional arguments, got 3. Usage: backlog sync status');
    expect(failure({ ...backlog, actions: { ...backlog.actions, sync: { ...backlog.actions!.sync!, args: [{ name: 'item', description: 'Item.' }] } } }, ['sync', 'a', 'b']).message)
      .toMatch(/Usage: backlog sync \[item\] \[--direction push\|pull\]$/);
  });

  it('fails an unknown action first, and a word after an action without arguments as an unknown sub-action', () => {
    expect(failure(backlog, ['sho', 'x'])).toMatchObject({ code: 'INVALID_ARGUMENT', details: { action: 'sho', suggestions: ['show'] } });
    expect(failure(backlog, ['sync', 'stats'])).toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringMatching(/^Unknown backlog action sync stats\./), details: { action: 'sync stats', suggestions: ['sync status'] } });
  });

  it('checks nothing about an invocation without declared arguments', () => {
    for (const args of [[], ['go'], ['go', 'a', 'b', 'c'], ['other', 'x']]) expect(() => ensureArguments(free, args), args.join(' ')).not.toThrow();
    expect(declaredArguments(free, ['go', 'a'])).toBeUndefined();
    expect(commandInputSchema(free)).toMatchObject({ oneOf: [{ properties: { args: { minItems: 0 } } }, { properties: { args: { minItems: 1 } } }] });
    expect(JSON.stringify(commandInputSchema(free))).not.toContain('maxItems');
  });

  it('publishes the bounds it enforces as minItems and maxItems', () => {
    const valid = (command: CommandMetadata, args: readonly string[]) => validateJsonValue(commandInputSchema(command), { args, options: {} }, 'input').issues.length === 0;
    for (const [command, args] of [[read, ['a.md']], [many, ['a']], [tags, []], [backlog, ['show', 'x']], [backlog, ['iteration', 'assign', 'a', 'b']]] as const) {
      const { minimum, maximum } = argumentBounds(declaredArguments(command, args)!);
      expect(valid(command, args), `${command.id} ${args.join(' ')}`).toBe(true);
      expect(valid(command, [...args, ...Array.from({ length: (maximum ?? 99) - args.length + 1 }, () => 'x')]), `${command.id} above`).toBe(maximum === undefined);
      if (minimum > 0) expect(valid(command, args.slice(0, minimum - 1)), `${command.id} below`).toBe(false);
    }
    expect(argumentBounds(declaredArguments(tags, [])!)).toEqual({ minimum: 0 });
    expect(argumentBounds(declaredArguments(many, [])!)).toEqual({ minimum: 1, maximum: 3 });
  });

  it('rejects malformed declarations at registration', () => {
    const invalid = (args: unknown) => () => validateCommandMetadata({ id: 'x', description: 'X', usage: 'x', args });
    expect(invalid([{ name: 'a', description: 'A.' }, { name: 'b', description: 'B.', required: true }])).toThrow(/required arguments come first/);
    expect(invalid([{ name: 'a', description: 'A.', variadic: true }, { name: 'b', description: 'B.' }])).toThrow(/only the last may be variadic/);
    expect(invalid([{ name: 'a', description: 'A.', maximum: 2 }])).toThrow(/positive integer maximum/);
    expect(invalid([{ name: 'a', description: 'A.', variadic: true, maximum: 0 }])).toThrow(/positive integer maximum/);
    expect(invalid([{ name: 'a', description: 'A.', required: 'yes' }])).toThrow(/boolean required/);
    expect(() => validateCommandMetadata({ id: 'x', description: 'X', usage: 'x', actions: { go: { description: 'Go.', args: [{ name: '', description: 'A.' }] } } })).toThrow(/action go args/);
    expect(invalid([{ name: 'a', description: 'A.', required: true }, { name: 'b', description: 'B.', variadic: true, maximum: 4 }])).not.toThrow();
  });

  it('keeps the concrete counts in German messages', () => {
    const german = new Localizer('de');
    expect(german.error(failure(move, ['a'])).message).toBe('Es fehlt <to>: erwartet 2 Positionsargumente, erhalten 1.');
    const unbounded: CommandMetadata = { ...many, args: [{ name: 'paths', description: 'Paths.', required: true, variadic: true }] };
    expect(german.error(failure(unbounded, [])).message).toBe('Es fehlt <paths>: erwartet mindestens 1 Positionsargumente, erhalten 0.');
    expect(german.error(failure(read, ['a', 'b'])).message).toBe('Überzählig: "b". Falsche Anzahl an Positionsargumenten: erwartet 1, erhalten 2.');
  });
});
