import { describe, expect, it } from 'vitest';
import { commandAnnotations, commandInputSchema, commandMode, ensureKnownAction, hasActionOptions, validateCommandMetadata, type CommandMetadata } from '../../src/application/plugins/command-metadata.ts';
import { errorCodes } from '../../src/domain/shared/error-catalog.ts';
import { jsonSchemaDialect, schemaIssues, validateJsonValue, type JsonSchema } from '../../src/domain/schema/json-schema.ts';
import { builtinCommands } from '../support/builtin-commands.ts';

const { commands } = builtinCommands();

describe('built-in command metadata', () => {
  it('declares scope, discovery and mutating for every built-in command and describes every option and action', () => {
    expect(commands.size).toBeGreaterThan(25);
    for (const command of commands.values()) {
      for (const key of ['scope', 'discovery', 'mutating'] as const) expect(command[key], `${command.id}.${key}`).toBeDefined();
      expect(() => validateCommandMetadata(command as unknown as Record<string, unknown>), command.id).not.toThrow();
      for (const code of command.errors ?? []) expect(errorCodes, `${command.id} declares ${code}`).toContain(code);
    }
  });

  it('marks exactly the discovery commands and derives annotations from metadata', () => {
    expect([...commands.values()].filter(command => command.discovery).map(command => command.id).sort()).toEqual(['config', 'events', 'formats', 'help', 'plugins', 'schema', 'setup']);
    expect(commandAnnotations(commands.get('read')!)).toEqual({ scope: 'project', discovery: false, mutating: false, readOnlyHint: true });
    // A command is read-only only when no action mutates; each action keeps its own mode.
    expect(commandAnnotations(commands.get('skills')!)).toMatchObject({ scope: 'workspace', mutating: true, readOnlyHint: false, defaultAction: 'list', actions: { list: { mutating: false, readOnlyHint: true }, install: { scope: 'project', mutating: true, readOnlyHint: false } } });
    expect(commandAnnotations(commands.get('bases')!)).toMatchObject({ mutating: false, readOnlyHint: true });
    expect(commandAnnotations(commands.get('make')!)).toMatchObject({ mutating: true, readOnlyHint: false });
    // The kernel make command stays generic; each generator documents its own usage.
    expect(commands.get('make')).toMatchObject({ description: 'Run a registered generator, or list the generators.', usage: 'make [generator Name] [--out directory]' });
    expect(commandAnnotations(commands.get('make')!).actions).toMatchObject({
      document: { usage: expect.stringContaining('make document Title --template name.md') }, 'data-source': { usage: expect.stringContaining('make data-source <id>') },
      entity: { scope: 'project', mutating: true, usage: 'make entity <Name>', options: { out: { type: 'string' } } }, plugin: { scope: 'workspace' }, ui: { scope: 'project', projectOption: 'project' },
    });
  });

  it('publishes a valid JSON Schema 2020-12 input contract for every command', () => {
    for (const command of commands.values()) {
      const schema = commandInputSchema(command);
      expect(schemaIssues(schema), command.id).toEqual([]);
      expect(schema).toMatchObject({ $schema: jsonSchemaDialect, title: command.id, type: 'object', required: ['args', 'options'] });
      const branches = schema.oneOf ?? [schema];
      if (schema.oneOf) expect(branches.length, command.id).toBeGreaterThanOrEqual(Object.keys(command.actions!).length);
      for (const branch of branches) {
        expect(branch).toMatchObject({ type: 'object', additionalProperties: false, required: ['args', 'options'] });
        expect(branch.properties!.args!.type).toBe('array');
        expect(Object.keys(branch.properties!.options!.properties!), command.id).toEqual(expect.arrayContaining(Object.keys(command.options ?? {})));
      }
    }
  });

  it('publishes one schema branch per generator with its own options and required options', () => {
    const make = commandInputSchema(commands.get('make')!);
    const check = (args: string[], options: Record<string, unknown>) => validateJsonValue(make, { args, options }, 'input').issues;
    expect(make.required).toEqual(['args', 'options']);
    expect(check([], {})).toEqual([]);
    expect(check(['entity', 'Order'], { out: 'src/domain/orders' })).toEqual([]);
    expect(check(['entity', 'Order'], { template: 'x.md' })).toEqual(['input.options.template: is not allowed']);
    expect(check(['document', 'Plan'], {})).toEqual(['input.options.template: is required']);
    expect(check(['document', 'Plan'], { template: 'prd.md' })).toEqual([]);
    expect(check(['ui', 'button'], { framework: 'react', plan: true })).toEqual([]);
    expect(check(['plugin', 'quality'], { out: 'x' })).toEqual(['input.options.out: is not allowed']);
    expect(check([], { out: 'x' })).toEqual(['input.options.out: is not allowed']);
    const links = commandInputSchema(commands.get('skills')!);
    expect(validateJsonValue(links, { args: [], options: {} }, 'input').issues).toEqual([]);
    expect(validateJsonValue(links, { args: ['install'], options: { out: 'skills' } }, 'input').issues).toEqual([]);
    expect(validateJsonValue(links, { args: ['remove'], options: {} }, 'input').issues).not.toEqual([]);
  });

  it('validates real invocations against the published schemas', () => {
    const edit = commandInputSchema(commands.get('edit')!);
    expect(validateJsonValue(edit, { args: ['note.md'], options: { 'if-match': 'a'.repeat(64), append: true, content: 'More' } }, 'input').issues).toEqual([]);
    expect(validateJsonValue(edit, { args: [], options: { append: 'yes' } }, 'input').issues).toEqual([
      'input.args: must have at least 1 items', 'input.options.if-match: is required', 'input.options.append: must be boolean',
    ]);
    const list = commandInputSchema(commands.get('list')!);
    expect(validateJsonValue(list, { args: [], options: { kind: 'video' } }, 'input').issues).toEqual([]);
    expect(validateJsonValue(list, { args: ['extra'], options: { kind: 'movie', unknown: true } }, 'input').issues).toEqual([
      'input.args: must have at most 0 items', 'input.options.kind: must be one of "markdown", "canvas", "base", "image", "audio", "video", "pdf", "text", "attachment"', 'input.options.unknown: is not allowed',
    ]);
    const claude = commandInputSchema(commands.get('claude')!);
    expect(validateJsonValue(claude, { args: ['plugins', 'install', 'review@team'], options: {} }, 'input').issues).toEqual([]);
  });
});

describe('command modes', () => {
  const command: CommandMetadata = {
    id: 'reports', description: 'Reports', usage: 'reports', defaultAction: 'list',
    actions: { list: { description: 'List', mutating: false }, publish: { description: 'Publish' } },
  };

  it('defaults undeclared commands to a mutating project command and refines by action', () => {
    expect(commandMode({ id: 'x', description: 'X', usage: 'x' }, [])).toEqual({ scope: 'project', discovery: false, mutating: true });
    expect(commandMode(command, [])).toEqual({ action: 'list', scope: 'project', discovery: false, mutating: false });
    expect(commandMode(command, ['publish'])).toEqual({ action: 'publish', scope: 'project', discovery: false, mutating: true });
    expect(commandMode(command, ['constructor'])).toEqual({ scope: 'project', discovery: false, mutating: true });
  });

  it('reports an unknown action with the declared code and resolves the action before options', () => {
    const closed: CommandMetadata = { id: 'reports', description: 'Reports', usage: 'reports', actions: command.actions!, unknownAction: 'UNKNOWN_GENERATOR' };
    expect(hasActionOptions(closed)).toBe(true);
    expect(hasActionOptions(command)).toBe(false);
    expect(() => ensureKnownAction(closed, ['missing', 'Name'])).toThrow(expect.objectContaining({ code: 'UNKNOWN_GENERATOR', message: 'missing' }));
    for (const args of [[], ['publish'], ['--template', 'x.md']]) expect(() => ensureKnownAction(closed, args)).not.toThrow();
    expect(() => ensureKnownAction(command, ['missing'])).not.toThrow();
    expect(commands.get('make')!.unknownAction).toBe('UNKNOWN_GENERATOR');
  });

  it.each([
    [{ unknownAction: 'UNKNOWN_GENERATOR' }, 'unknownAction must be a built-in error code of a command with actions'],
    [{ actions: { list: { description: 'List' } }, unknownAction: 'QUALITY_MISSING' }, 'unknownAction must be a built-in error code'],
    [{ scope: 'global' }, 'scope must be workspace or project'],
    [{ options: { label: 'string' } }, 'requires type string or boolean and a description'],
    [{ options: { label: { type: 'string', description: 'L', default: true } } }, 'default must match its type'],
    [{ options: { help: { type: 'boolean', description: 'H' } } }, 'Invalid command option help'],
    [{ projectOption: 'target' }, 'projectOption must name a declared string option'],
    [{ actions: { list: {} } }, 'action list requires a description'],
    [{ defaultAction: 'list' }, 'defaultAction must name a declared action'],
    [{ args: [{ name: 'rest', description: 'R', variadic: true }, { name: 'last', description: 'L' }] }, 'only the last may be variadic'],
    [{ errors: ['bad-code'] }, 'UPPER_SNAKE_CASE'],
    [{ output: { type: 'object', allOf: [] } }, 'unsupported keyword allOf'],
  ])('rejects invalid plugin metadata %#', (extra, message) => {
    expect(() => validateCommandMetadata({ id: 'quality.run', description: 'Run', usage: 'quality.run', ...extra })).toThrow(expect.objectContaining({ code: 'INVALID_PLUGIN', message: expect.stringContaining(message) }));
  });
});

describe('JSON Schema subset', () => {
  it('fills nested defaults and reports type, range, pattern and enum problems with paths', () => {
    const schema: JsonSchema = {
      type: 'object', properties: {
        name: { type: 'string', pattern: '^[a-z]+$', minLength: 2 },
        limits: { type: 'object', properties: { max: { type: 'integer', default: 10, maximum: 50 } }, default: {} },
        tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
      },
    };
    expect(validateJsonValue(schema, { name: 'ok', limits: {} }, 's')).toEqual({ value: { name: 'ok', limits: { max: 10 } }, issues: [] });
    expect(validateJsonValue(schema, { name: 'X', limits: { max: 60.5 }, tags: ['c'] }, 's').issues).toEqual([
      's.name: must have at least 2 characters', 's.name: must match ^[a-z]+$', 's.limits.max: must be integer', 's.tags[0]: must be one of "a", "b"',
    ]);
  });

  it('rejects unsupported keywords and malformed schemas in the meta-check', () => {
    expect(schemaIssues({ type: 'object', properties: { a: { type: 'date' } }, required: ['a', 'a'], pattern: '(' })).toEqual([
      'schema.properties.a.type must be one of object, array, string, number, integer, boolean, null',
      'schema.required must list unique property names', 'schema.pattern must be a valid regular expression',
    ]);
    expect(schemaIssues({ $ref: '#/x' })).toEqual(['schema uses unsupported keyword $ref']);
    expect(schemaIssues('object')).toEqual(['schema must be a schema object']);
  });
});
