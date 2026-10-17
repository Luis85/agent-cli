import { describe, expect, it } from 'vitest';
import { anyActionOptions, commandAnnotations, commandInputSchema, commandMode, commandOptions, commandOutputSchema, ensureKnownAction, hasActionOptions, option, validateCommandMetadata, type CommandMetadata } from '../../src/application/plugins/command-metadata.ts';
import { errorCodes } from '../../src/domain/shared/error-catalog.ts';
import { jsonSchemaDialect, schemaIssues, validateJsonValue, type JsonSchema } from '../../src/domain/schema/json-schema.ts';
import { builtinCommands } from '../support/builtin-commands.ts';
import { testHost } from '../support/core-plugins.ts';
import { searchPlugin } from '../../src/plugins/search/plugin.ts';
import { linksPlugin } from '../../src/plugins/links/plugin.ts';
import { applyPlanSchema, literalEditsSchema } from '../../src/domain/documents/apply-plan.ts';

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
    expect([...commands.values()].filter(command => command.discovery).map(command => command.id).sort()).toEqual(['config', 'events', 'formats', 'help', 'plugins', 'schema', 'server', 'setup']);
    expect(commandAnnotations(commands.get('read')!)).toEqual({ scope: 'project', discovery: false, mutating: false, readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    // A command is read-only only when no action mutates; each action keeps its own mode.
    expect(commandAnnotations(commands.get('skills')!)).toMatchObject({ scope: 'workspace', mutating: true, readOnlyHint: false, defaultAction: 'list', actions: { list: { mutating: false, readOnlyHint: true }, install: { scope: 'project', mutating: true, readOnlyHint: false } } });
    expect(commandAnnotations(commands.get('bases')!)).toMatchObject({ mutating: false, readOnlyHint: true });
    expect(commandAnnotations(commands.get('server')!)).toMatchObject({
      scope: 'workspace', discovery: true, mutating: true, readOnlyHint: false, defaultAction: 'status',
      actions: {
        status: { scope: 'workspace', discovery: true, mutating: false, readOnlyHint: true },
        start: { scope: 'workspace', discovery: true, mutating: true, destructiveHint: false, idempotentHint: true },
        stop: { scope: 'workspace', discovery: true, mutating: true, destructiveHint: false, idempotentHint: true },
      },
    });
    expect(commandAnnotations(commands.get('make')!)).toMatchObject({ mutating: true, readOnlyHint: false });
    // The kernel make command stays generic; each generator documents its own usage.
    expect(commands.get('make')).toMatchObject({ description: 'Run a registered generator, or list the generators.', usage: 'make [generator Name] [--out directory]' });
    // Library generators keep the shared review controls after --project and --library, before their own options.
    const optionOrder = (id: string) => Object.keys(commandAnnotations(commands.get('make')!).actions![id]!.options!);
    const library = ['out', 'project', 'library', 'revisions-from', 'plan', 'plan-out', 'check'];
    expect(optionOrder('ui')).toEqual([...library, 'framework', 'stories', 'stories-out', 'interactions-library']);
    expect(optionOrder('stories')).toEqual([...library, 'framework', 'stories-out', 'interactions-library']);
    expect(optionOrder('data-source')).toEqual([...library, 'test-data-out']);
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

  it('carries the JSON document schemas of string options and arguments as content annotations', () => {
    const { $schema: _dialect, ...plan } = applyPlanSchema;
    expect(commandInputSchema(commands.get('edit')!).properties!.options!.properties!.edits).toMatchObject({ type: 'string', contentMediaType: 'application/json', contentSchema: literalEditsSchema });
    expect(commandInputSchema(commands.get('apply')!).properties!.args!.prefixItems![0]).toEqual(expect.objectContaining({ type: 'string', contentMediaType: 'application/json', contentSchema: plan }));
    // Annotations only: the string itself still validates, whatever document it holds or names.
    expect(validateJsonValue(commandInputSchema(commands.get('apply')!), { args: ['plan.json'], options: {} }, 'input').issues).toEqual([]);
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
    expect(() => ensureKnownAction(closed, ['missing', 'Name'])).toThrow(expect.objectContaining({
      code: 'UNKNOWN_GENERATOR', message: 'Unknown generator missing. Generators: list, publish.', details: { generator: 'missing', allowed: ['list', 'publish'], suggestions: [] },
    }));
    // An action command names the action it does not know, the declared actions and the closest of them.
    expect(() => ensureKnownAction({ ...closed, unknownAction: 'INVALID_ARGUMENT' }, ['publsh'])).toThrow(expect.objectContaining({
      code: 'INVALID_ARGUMENT', message: 'Unknown reports action publsh. Actions: list, publish.', details: { action: 'publsh', allowed: ['list', 'publish'], suggestions: ['publish'] },
    }));
    for (const args of [[], ['publish'], ['--template', 'x.md']]) expect(() => ensureKnownAction(closed, args)).not.toThrow();
    expect(() => ensureKnownAction(command, ['missing'])).not.toThrow();
    expect(commands.get('make')!.unknownAction).toBe('UNKNOWN_GENERATOR');
  });

  it('selects the longest action id of several words that the leading arguments spell, with exactly its options', () => {
    const grouped: CommandMetadata = {
      id: 'plan', description: 'Plan', usage: 'plan', unknownAction: 'INVALID_ARGUMENT',
      options: { base: option.string('Base.') },
      actions: {
        sync: { description: 'Sync', options: { direction: option.string('Direction.') } },
        'sync resolve': { description: 'Resolve', idempotent: true, options: { take: option.string('Take.', { required: true }) } },
        'iteration add': { description: 'Add', options: { goal: option.string('Goal.') } },
        'iteration assign': { description: 'Assign', mutating: false, options: { goal: option.boolean('Not a goal.') } },
      },
      args: [{ name: 'action', description: 'Action.' }, { name: 'operands', description: 'Operands.', variadic: true }],
    };
    expect(() => validateCommandMetadata(grouped as unknown as Record<string, unknown>)).not.toThrow();
    expect(commandMode(grouped, ['sync', 'resolve', 'Item'])).toMatchObject({ action: 'sync resolve' });
    expect(commandMode(grouped, ['sync', 'Item'])).toMatchObject({ action: 'sync' });
    expect(commandMode(grouped, ['iteration', 'assign', 'Item'])).toMatchObject({ action: 'iteration assign', mutating: false });
    expect(commandMode(grouped, ['iteration'])).toEqual({ scope: 'project', discovery: false, mutating: true });
    expect(Object.keys(commandOptions(grouped, ['sync', 'resolve']))).toEqual(['base', 'take']);
    expect(Object.keys(commandOptions(grouped, ['sync']))).toEqual(['base', 'direction']);
    // The first parsing pass knows every option whose type the actions agree on, so it can find the action words.
    expect(anyActionOptions(grouped)).toEqual({ base: 'string', direction: 'string', take: 'string' });
    expect(() => ensureKnownAction(grouped, ['iteration', 'remove'])).toThrow(expect.objectContaining({
      code: 'INVALID_ARGUMENT', message: 'Unknown plan action iteration remove. Actions: sync, sync resolve, iteration add, iteration assign.',
      details: expect.objectContaining({ action: 'iteration remove', allowed: ['sync', 'sync resolve', 'iteration add', 'iteration assign'] }),
    }));
    expect(() => ensureKnownAction(grouped, ['iteration'])).toThrow(expect.objectContaining({ details: expect.objectContaining({ action: 'iteration' }) }));
    for (const args of [['sync'], ['sync', 'status'], ['iteration', 'add'], ['--goal', 'x']]) expect(() => ensureKnownAction(grouped, args), args.join(' ')).not.toThrow();
    expect(commandAnnotations(grouped).actions).toMatchObject({ 'sync resolve': { idempotentHint: true }, 'iteration assign': { readOnlyHint: true } });
    const schema = commandInputSchema(grouped);
    const valid = (args: string[], options: Record<string, unknown> = {}) => validateJsonValue(schema, { args, options }, 'input').issues.length === 0;
    expect(valid(['sync'], { direction: 'pull' })).toBe(true);
    expect(valid(['sync', 'resolve', 'Item'], { take: 'local' })).toBe(true);
    // The bare sync branch never matches the words of a longer id, so each invocation matches exactly one branch.
    expect(valid(['sync', 'resolve', 'Item'], { direction: 'pull' })).toBe(false);
    expect(valid(['iteration', 'add'], { goal: 'x' })).toBe(true);
    expect(valid(['iteration', 'assign', 'Item'], { goal: 'x' })).toBe(false);
    expect(valid(['iteration'])).toBe(false);
  });

  it.each([
    [{ unknownAction: 'UNKNOWN_GENERATOR' }, 'unknownAction must be UNKNOWN_GENERATOR or INVALID_ARGUMENT for a command with actions'],
    [{ actions: { list: { description: 'List' } }, unknownAction: 'CONFLICT' }, 'unknownAction must be UNKNOWN_GENERATOR or INVALID_ARGUMENT'],
    [{ scope: 'global' }, 'scope must be workspace or project'],
    [{ options: { label: 'string' } }, 'requires type string or boolean and a description'],
    [{ options: { label: { type: 'string', description: 'L', default: true } } }, 'default must match its type'],
    [{ options: { help: { type: 'boolean', description: 'H' } } }, 'Invalid command option help'],
    [{ projectOption: 'target' }, 'projectOption must name a declared string option'],
    [{ options: { parts: { type: 'string', description: 'P', list: true } } }, 'a list option needs an enum'],
    [{ options: { parts: { type: 'string', description: 'P', enum: ['a,b'], list: true } } }, 'without commas'],
    [{ actions: { list: {} } }, 'action list requires a description'],
    [{ defaultAction: 'list' }, 'defaultAction must name a declared action'],
    [{ args: [{ name: 'rest', description: 'R', variadic: true }, { name: 'last', description: 'L' }] }, 'only the last may be variadic'],
    [{ errors: ['bad-code'] }, 'UPPER_SNAKE_CASE'],
    [{ output: { type: 'object', allOf: [] } }, 'unsupported keyword allOf'],
    [{ destructive: 'yes' }, 'destructive must be a boolean'],
    [{ actions: { run: { description: 'Run', idempotent: 1 } } }, 'action run idempotent must be a boolean'],
    [{ actions: { run: { description: 'Run', output: { type: 'text' } } } }, 'action run output must be a supported JSON Schema'],
  ])('rejects invalid plugin metadata %#', (extra, message) => {
    expect(() => validateCommandMetadata({ id: 'quality.run', description: 'Run', usage: 'quality.run', ...extra })).toThrow(expect.objectContaining({ code: 'INVALID_PLUGIN', message: expect.stringContaining(message) }));
  });
});

describe('derived behavior annotations and output schemas', () => {
  const reports: CommandMetadata = {
    id: 'reports', description: 'Reports', usage: 'reports', defaultAction: 'list', output: { type: 'object' },
    options: { 'if-match': { type: 'string', description: 'Revision.', required: true } },
    actions: {
      list: { description: 'List', mutating: false, output: { type: 'array' } },
      draft: { description: 'Draft', destructive: false },
      publish: { description: 'Publish', idempotent: false },
    },
  };

  it('defaults a mutating mode to destructive, and to idempotent only when it requires --if-match', () => {
    expect(commandAnnotations({ id: 'x', description: 'X', usage: 'x' })).toMatchObject({ mutating: true, readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(commandAnnotations({ ...reports, actions: undefined, defaultAction: undefined })).toMatchObject({ destructiveHint: true, idempotentHint: true });
    // An optional --if-match guards nothing when it is omitted: `backlog add` twice creates two notes.
    const optional: CommandMetadata = { ...reports, actions: undefined, defaultAction: undefined, options: { 'if-match': { type: 'string', description: 'Revision.' } } };
    expect(commandAnnotations(optional)).toMatchObject({ destructiveHint: true, idempotentHint: false });
    expect(commandAnnotations({ ...optional, idempotent: true })).toMatchObject({ idempotentHint: true });
    const actionGuard: CommandMetadata = { id: 'y', description: 'Y', usage: 'y', actions: { sign: { description: 'Sign', options: { 'if-match': { type: 'string', description: 'Revision.', required: true } } }, add: { description: 'Add' } } };
    expect(commandAnnotations(actionGuard).actions).toMatchObject({ sign: { idempotentHint: true }, add: { idempotentHint: false } });
    expect(commandAnnotations(reports)).toMatchObject({
      readOnlyHint: false, destructiveHint: true, idempotentHint: false,
      actions: {
        list: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        draft: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        publish: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      },
    });
    for (const id of ['write', 'edit', 'delete', 'move']) expect(commandAnnotations(commands.get(id)!), id).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(commandAnnotations(commands.get('create')!)).toMatchObject({ destructiveHint: false, idempotentHint: true });
    expect(commandAnnotations(commands.get('skills')!)).toMatchObject({ destructiveHint: false, actions: { install: { destructiveHint: false, idempotentHint: true } } });
  });

  it('resolves the output schema of an invocation from the selected action, else the command', () => {
    expect(commandOutputSchema(reports, [])).toEqual({ $schema: jsonSchemaDialect, title: 'reports list output', type: 'array' });
    expect(commandOutputSchema(reports, ['draft'])).toEqual({ $schema: jsonSchemaDialect, title: 'reports output', type: 'object' });
    expect(commandOutputSchema({ id: 'x', description: 'X', usage: 'x' }, [])).toBeUndefined();
    expect(commandAnnotations(reports).actions!.list).toMatchObject({ outputSchema: { title: 'reports list output', type: 'array' } });
    expect(commandAnnotations(reports).actions!.draft).not.toHaveProperty('outputSchema');
    const [search, links] = [searchPlugin, linksPlugin].map(plugin => plugin.create(testHost()).commands![0]!);
    for (const command of [...['read', 'list', 'validate', 'config', 'schema'].map(id => commands.get(id)!), search!]) expect(commandOutputSchema(command, ['x']), command.id).toMatchObject({ $schema: jsonSchemaDialect, type: 'object' });
    for (const action of ['out', 'back', 'unresolved', 'orphans', 'deadends']) expect(commandOutputSchema(links!, [action]), action).toMatchObject({ title: `links ${action} output` });
    expect(commandOutputSchema(commands.get('project')!, ['current'])).toMatchObject({ title: 'project current output', required: ['project'] });
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
