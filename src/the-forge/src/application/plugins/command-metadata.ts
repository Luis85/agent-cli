import { ensure, forgeError, isRecord } from '../../domain/shared/errors.ts';
import { jsonSchemaDialect, schemaIssues, type JsonSchema } from '../../domain/schema/json-schema.ts';
import { actionSuggestions } from './suggestions.ts';

/**
 * Declarative command metadata. One description drives argument parsing, the invocation policy (scope and plugin
 * activation), `help`, and the JSON Schema that `schema` publishes; commands never repeat it in code.
 *
 * - `scope`: `project` runs in the selected project (the workspace when none is selected); `workspace` always runs
 *   at the workspace root. Default `project`.
 * - `discovery`: a discovery or recovery command runs at workspace scope without activating plugins, so a stale
 *   selection or a failing plugin `onload` cannot block it. Default `false`.
 * - `mutating`: whether the command can change files or external state. Default `true` for undeclared commands.
 * - `actions`: refinements keyed by the leading positional arguments (`skills install`), with `defaultAction` used
 *   when they are omitted. An id of several words, such as `iteration add`, names a sub-action: the arguments
 *   select the longest id they start with, so `backlog iteration add` selects `iteration add`. A refinement
 *   inherits every field it does not set and may add its own `options`, which the parser accepts only for that
 *   action (`make <generator>`).
 * - `unknownAction`: the code for a first argument that names no declared action, `UNKNOWN_GENERATOR` or
 *   `INVALID_ARGUMENT`. It outranks option errors, so options of an unknown action never read as `UNKNOWN_OPTION`.
 * - `projectOption`: a string option that explicitly selects the project (`make ui --project web`).
 * - `destructive`: whether a mutating mode can replace or remove existing content. Default `true` for a mutating
 *   mode, so only modes that never touch existing files (`create`, `setup`) declare `false`.
 * - `idempotent`: whether repeating the identical invocation has no further effect. Default: a read-only mode is
 *   idempotent, and so is one that requires `--if-match`: the repeat fails on the changed revision. A mode whose
 *   `--if-match` is optional declares `idempotent` itself when a repeat is refused or changes nothing.
 * - `output`: the JSON Schema of `data` in a successful response, on the command or, overriding it, on an action.
 * - `examples`: one to three complete invocations that start with the command id, which `help <command>` shows.
 */
export type CommandScope = 'workspace' | 'project';
const unknownActionCodes = ['UNKNOWN_GENERATOR', 'INVALID_ARGUMENT'] as const;
export type UnknownActionCode = typeof unknownActionCodes[number];
export type CommandFlags = Record<string, string | boolean>;
/**
 * `schema` describes the JSON document a string option or argument holds or names, such as `apply`'s plan; `help`
 * and `schema` publish it with the option or argument. `list` makes a string option with an `enum` a comma-separated
 * list of its values (`read --parts body`); its input schema is a `pattern` instead of the `enum`. `path` marks a
 * string option or argument that names a file or folder in the command scope: the host accepts `\` separators, a
 * leading `./` and an absolute path inside the scope root, passes the command the relative POSIX path and refuses
 * any other invalid path with INVALID_PATH naming the option or argument.
 */
export interface CommandOption {
  type: 'string' | 'boolean'; description: string;
  enum?: readonly string[]; list?: boolean; default?: string | boolean; required?: boolean; schema?: JsonSchema; path?: boolean;
}
export interface CommandArgument { name: string; description: string; required?: boolean; enum?: readonly string[]; variadic?: boolean; schema?: JsonSchema; path?: boolean }
const documentSchema = (value: unknown) => value === undefined || schemaIssues(value).length === 0;
export interface CommandMode {
  scope?: CommandScope; discovery?: boolean; mutating?: boolean; projectOption?: string;
  destructive?: boolean; idempotent?: boolean;
}
export interface CommandAction extends CommandMode {
  description: string; usage?: string;
  /** Options accepted only with this action, besides the command's own; names never repeat a command option. */
  options?: Readonly<Record<string, CommandOption>>;
  /** JSON Schema of `data` for this action; overrides the command's `output`. */
  output?: JsonSchema;
}
export interface CommandMetadata extends CommandMode {
  id: string; description: string; usage: string;
  options?: Readonly<Record<string, CommandOption>>;
  args?: readonly CommandArgument[];
  actions?: Readonly<Record<string, CommandAction>>;
  defaultAction?: string;
  unknownAction?: UnknownActionCode;
  /** Optional JSON Schema of `data` in a successful response. */
  output?: JsonSchema;
  /** Failure codes the command reports itself, beyond the input and routing codes every command can raise. */
  errors?: readonly string[];
  /** One to three invocations after `forge`, each starting with the command id; examples are not translated. */
  examples?: readonly string[];
}
/** The words of an action id: `iteration add` selects the arguments `iteration`, `add`. */
const actionWords = (id: string): string[] => id.split(' ');

/**
 * The id of the action the arguments select: the longest declared id whose words the leading arguments spell, or
 * the default action when no argument is given.
 */
function actionId(command: CommandMetadata, args: readonly string[]): string | undefined {
  if (args.length === 0) return command.defaultAction;
  let selected: string | undefined;
  for (const id of Object.keys(command.actions ?? {})) {
    const words = actionWords(id);
    if (words.every((word, index) => args[index] === word) && words.length > (selected === undefined ? 0 : actionWords(selected).length)) selected = id;
  }
  return selected;
}

export interface ResolvedMode { action?: string; scope: CommandScope; discovery: boolean; mutating: boolean; projectOption?: string }

/** Option schema builders for command definitions. */
export const option = {
  string: (description: string, extra: Omit<CommandOption, 'type' | 'description'> = {}): CommandOption => ({ type: 'string', description, ...extra }),
  boolean: (description: string, extra: Omit<CommandOption, 'type' | 'description'> = {}): CommandOption => ({ type: 'boolean', description, ...extra }),
};

/** The mode an invocation runs in: the action refinement for the first argument, over the command's own fields. */
export function commandMode(command: CommandMetadata, args: readonly string[]): ResolvedMode {
  const action = actionId(command, args);
  const refined = action === undefined ? undefined : command.actions?.[action];
  const projectOption = refined?.projectOption ?? command.projectOption;
  return {
    ...(refined ? { action } : {}),
    scope: refined?.scope ?? command.scope ?? 'project',
    discovery: refined?.discovery ?? command.discovery ?? false,
    mutating: refined?.mutating ?? command.mutating ?? true,
    ...(projectOption === undefined ? {} : { projectOption }),
  };
}

/** The action an invocation selects: the longest action id its leading arguments spell, else the default action. */
function selectedAction(command: CommandMetadata, args: readonly string[]): CommandAction | undefined {
  const action = actionId(command, args);
  return action === undefined ? undefined : command.actions?.[action];
}

/** The options an invocation accepts: the command's own plus those of the action its arguments select. */
export function commandOptions(command: CommandMetadata, args: readonly string[]): Record<string, CommandOption> {
  return { ...command.options, ...selectedAction(command, args)?.options };
}

/** Whether parsing must resolve the action first: some action declares its own options, or unknown actions fail. */
export function hasActionOptions(command: CommandMetadata): boolean {
  return command.unknownAction !== undefined || Object.values(command.actions ?? {}).some(action => Object.keys(action.options ?? {}).length > 0);
}

/**
 * The options the first parsing pass knows, so that options before or between the action words cannot hide the
 * action: the command's own and every action's, except names that actions declare with different types.
 */
export function anyActionOptions(command: CommandMetadata): Record<string, 'string' | 'boolean'> {
  const types = new Map<string, 'string' | 'boolean' | null>();
  for (const options of [command.options, ...Object.values(command.actions ?? {}).map(action => action.options)]) {
    for (const [key, schema] of Object.entries(options ?? {})) types.set(key, types.has(key) && types.get(key) !== schema.type ? null : schema.type);
  }
  return Object.fromEntries([...types].filter((entry): entry is [string, 'string' | 'boolean'] => entry[1] !== null));
}

/**
 * Fails with the command's `unknownAction` code when the leading arguments (not options) select no declared action.
 * The message lists the declared actions, which `details.allowed` holds with the closest in `details.suggestions`.
 */
export function ensureKnownAction(command: CommandMetadata, args: readonly string[]): void {
  const action = args[0];
  if (command.unknownAction === undefined || action === undefined || action.startsWith('-') || actionId(command, args) !== undefined) return;
  // A first word that only sub-actions start with (`iteration`) is unknown together with the word after it.
  const group = Object.keys(command.actions ?? {}).some(id => id.startsWith(`${action} `)) && args[1] !== undefined && !args[1].startsWith('-');
  unknownAction(command.unknownAction, command, group ? `${action} ${args[1]}` : action);
}
function unknownAction(code: 'UNKNOWN_GENERATOR' | 'INVALID_ARGUMENT', command: CommandMetadata, action: string): never {
  const allowed = Object.keys(command.actions ?? {}), suggestions = actionSuggestions(action, allowed);
  const message = code === 'UNKNOWN_GENERATOR' ? `Unknown generator ${action}. Generators: ${allowed.join(', ')}.` : `Unknown ${command.id} action ${action}. Actions: ${allowed.join(', ')}.`;
  throw forgeError(code, message, { [code === 'UNKNOWN_GENERATOR' ? 'generator' : 'action']: action, allowed, suggestions });
}

/** Option types for the argument parser. */
export function optionTypes(options: CommandMetadata['options']): Record<string, 'string' | 'boolean'> {
  return Object.fromEntries(Object.entries(options ?? {}).map(([key, schema]) => [key, schema.type]));
}

/**
 * A string option or argument with a declared `schema` holds or names a JSON document (inline JSON, `@file`, `-` or
 * a path, as its description says); the input schema carries the document's schema as a 2020-12 content annotation.
 */
function documentContent(schema: JsonSchema | undefined): JsonSchema {
  if (schema === undefined) return {};
  const { $schema: _dialect, ...document } = schema;
  return { contentMediaType: 'application/json', contentSchema: document };
}

/** The items of a `list` option's value: comma-separated, with whitespace around each item ignored. */
export function listOptionItems(value: string): string[] {
  return value.split(',').map(item => item.trim());
}

/** The `pattern` of a comma-separated list of `values`: one or more of them, separated by commas, as `listOptionItems` reads it. */
function listPattern(values: readonly string[]): string {
  const value = `\\s*(?:${values.map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*`;
  return `^${value}(?:,${value})*$`;
}

function optionSchema(schema: CommandOption): JsonSchema {
  const values = schema.enum === undefined ? {} : schema.list ? { pattern: listPattern(schema.enum) } : { enum: [...schema.enum] };
  return {
    type: schema.type, description: schema.description, ...values,
    ...(schema.default === undefined ? {} : { default: schema.default }), ...documentContent(schema.schema),
  };
}

const positionalSchema = (arg: CommandArgument): JsonSchema => ({ type: 'string', description: arg.description, ...(arg.enum ? { enum: [...arg.enum] } : {}), ...documentContent(arg.schema) });

/** A `pattern` that matches any string except the given words. */
const exceptWords = (words: readonly string[]) => `^(?!(?:${words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$)`;

/**
 * `args` and `options` of one invocation shape; `action` pins the leading arguments to the words of one action id,
 * and the argument after them never spells `extended`, the next words of the longer ids that extend the action.
 */
function invocationSchema(usage: string, args: readonly CommandArgument[], options: Readonly<Record<string, CommandOption>>, action?: string, extended: readonly string[] = []): JsonSchema {
  const required = Object.entries(options).filter(([, schema]) => schema.required).map(([key]) => key);
  const variadic = args.at(-1)?.variadic === true;
  const positional = args.map(positionalSchema), rest = variadic ? positional.at(-1)! : { type: 'string' as const };
  const words = action === undefined || args.length === 0 ? [] : actionWords(action);
  words.forEach((word, index) => { positional[index] = { type: 'string', const: word, description: (args[index] ?? args.at(-1)!).description }; });
  if (extended.length > 0) positional[words.length] = { ...(positional[words.length] ?? rest), pattern: exceptWords(extended) };
  const minimum = Math.max(args.filter(arg => arg.required).length, words.length);
  const maximum = variadic ? undefined : Math.max(args.length, words.length);
  return {
    type: 'object', additionalProperties: false, required: ['args', 'options'],
    properties: {
      args: {
        type: 'array', description: usage, items: rest,
        ...(positional.length > 0 ? { prefixItems: positional } : {}),
        minItems: minimum, ...(maximum === undefined ? {} : { maxItems: maximum }),
      },
      options: {
        type: 'object', additionalProperties: false,
        properties: Object.fromEntries(Object.entries(options).map(([key, schema]) => [key, optionSchema(schema)])),
        ...(required.length > 0 ? { required } : {}),
      },
    },
  };
}

/**
 * JSON Schema 2020-12 of one invocation: `args` are the positional arguments after the command id and `options`
 * the command's own flags (global options are described once in the catalog). A command with actions publishes
 * one `oneOf` branch per action, keyed by the words of its id as `const` leading arguments, with that action's
 * options and required options; when the first argument is optional, a further branch without arguments covers
 * the default action.
 */
export function commandInputSchema(command: CommandMetadata): JsonSchema {
  const head = { $schema: jsonSchemaDialect, title: command.id, description: command.description };
  const args = command.args ?? [];
  if (!command.actions || args.length === 0) return { ...head, ...invocationSchema(command.usage, args, command.options ?? {}) };
  const ids = Object.keys(command.actions);
  const branches = Object.entries(command.actions).map(([id, action]): JsonSchema => ({
    title: `${command.id} ${id}`, description: action.description,
    ...invocationSchema(action.usage ?? command.usage, args, { ...command.options, ...action.options }, id,
      [...new Set(ids.filter(other => other.startsWith(`${id} `)).map(other => actionWords(other)[actionWords(id).length]!))]),
  }));
  const omitted: JsonSchema[] = args[0]!.required ? [] : [{
    title: command.defaultAction === undefined ? command.id : `${command.id} (${command.defaultAction})`,
    description: command.defaultAction === undefined ? command.description : command.actions[command.defaultAction]!.description,
    ...invocationSchema(command.usage, [], commandOptions(command, [])),
  }];
  return { ...head, type: 'object', required: ['args', 'options'], oneOf: [...omitted, ...branches] };
}

/**
 * Behavior hints of one mode, named as MCP tool annotations: `readOnlyHint` negates `mutating`; `destructiveHint`
 * and `idempotentHint` follow the declared `destructive` and `idempotent` fields or their derived defaults.
 */
function modeHints(command: CommandMetadata, args: readonly string[]) {
  const action = selectedAction(command, args);
  const { mutating } = commandMode(command, args);
  // Only a required --if-match guards every invocation; an optional one is often omitted, as in `backlog add`.
  const guarded = commandOptions(command, args)['if-match']?.required === true;
  return {
    readOnlyHint: !mutating,
    destructiveHint: mutating && (action?.destructive ?? command.destructive ?? true),
    idempotentHint: !mutating || (action?.idempotent ?? command.idempotent ?? guarded),
  };
}

/** A declared output schema as a standalone JSON Schema 2020-12 document. */
export const outputDocument = (title: string, schema: JsonSchema): JsonSchema => ({ $schema: jsonSchemaDialect, title: `${title} output`, ...schema });

/**
 * The published schema of `data` in a successful response to one invocation: the selected action's own `output`,
 * else the command's, or `undefined` when neither declares one.
 */
export function commandOutputSchema(command: CommandMetadata, args: readonly string[]): JsonSchema | undefined {
  const id = actionId(command, args), action = selectedAction(command, args);
  if (action?.output) return outputDocument(`${command.id} ${id}`, action.output);
  return command.output ? outputDocument(command.id, command.output) : undefined;
}

/**
 * Annotations for agents: the default mode's scope and discovery, plus each action's refinement. `mutating` (and
 * `readOnlyHint`, its negation) covers every mode, so a command is read-only only when none of its actions mutates;
 * `destructiveHint` holds when any mode is destructive and `idempotentHint` only when every mode is idempotent.
 */
export function commandAnnotations(command: CommandMetadata) {
  const { scope, discovery } = commandMode(command, []);
  const modes = [[], ...Object.keys(command.actions ?? {}).map(actionWords)];
  const hints = modes.map(args => ({ ...commandMode(command, args), ...modeHints(command, args) }));
  const mutating = hints.some(mode => mode.mutating);
  return {
    scope, discovery, mutating, readOnlyHint: !mutating,
    destructiveHint: hints.some(mode => mode.destructiveHint), idempotentHint: hints.every(mode => mode.idempotentHint),
    ...(command.defaultAction === undefined ? {} : { defaultAction: command.defaultAction }),
    ...(command.actions ? { actions: Object.fromEntries(Object.entries(command.actions).map(([id, action]) => {
      const words = actionWords(id), mode = commandMode(command, words);
      return [id, {
        description: action.description, ...(action.usage ? { usage: action.usage } : {}),
        scope: mode.scope, discovery: mode.discovery, mutating: mode.mutating, ...modeHints(command, words),
        ...(mode.projectOption ? { projectOption: mode.projectOption } : {}), ...(action.options ? { options: action.options } : {}),
        ...(action.output ? { outputSchema: commandOutputSchema(command, words) } : {}),
      }];
    })) } : {}),
  };
}

const reservedOptions = ['root', 'lang', 'events', 'json', 'no-json', 'dry-run', 'no-dry-run', 'no-plugins', 'wait', 'help', 'version'];
const flag = /^[a-z][a-z0-9-]*$/;
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
function validateOptions(options: Record<string, unknown>, shared: Readonly<Record<string, unknown>> = {}): void {
  for (const [key, schema] of Object.entries(options)) {
    ensure(flag.test(key) && !reservedOptions.includes(key) && !Object.hasOwn(shared, key), 'INVALID_PLUGIN', `Invalid command option ${key}.`);
    ensure(isRecord(schema) && (schema.type === 'string' || schema.type === 'boolean') && text(schema.description), 'INVALID_PLUGIN', `Command option ${key} requires type string or boolean and a description.`);
    ensure(schema.enum === undefined || (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(item => typeof item === 'string')), 'INVALID_PLUGIN', `Command option ${key} enum must list strings.`);
    ensure(schema.list === undefined || (typeof schema.list === 'boolean' && (!schema.list || (schema.type === 'string' && schema.enum !== undefined && (schema.enum as string[]).every(item => item.length > 0 && !item.includes(','))))), 'INVALID_PLUGIN', `Command option ${key} list must be a boolean, and a list option needs an enum of values without commas.`);
    ensure(schema.default === undefined || typeof schema.default === schema.type, 'INVALID_PLUGIN', `Command option ${key} default must match its type.`);
    ensure(schema.required === undefined || typeof schema.required === 'boolean', 'INVALID_PLUGIN', `Command option ${key} required must be a boolean.`);
    ensure(documentSchema(schema.schema) && (schema.schema === undefined || schema.type === 'string'), 'INVALID_PLUGIN', `Command option ${key} schema must be a supported JSON Schema on a string option.`);
    ensure(schema.path === undefined || (typeof schema.path === 'boolean' && schema.type === 'string'), 'INVALID_PLUGIN', `Command option ${key} path must be a boolean on a string option.`);
  }
}
function validateMode(mode: Record<string, unknown>, where: string, options: CommandMetadata['options']): void {
  ensure(mode.scope === undefined || mode.scope === 'workspace' || mode.scope === 'project', 'INVALID_PLUGIN', `${where} scope must be workspace or project.`);
  for (const key of ['discovery', 'mutating', 'destructive', 'idempotent']) ensure(mode[key] === undefined || typeof mode[key] === 'boolean', 'INVALID_PLUGIN', `${where} ${key} must be a boolean.`);
  ensure(mode.output === undefined || schemaIssues(mode.output).length === 0, 'INVALID_PLUGIN', `${where} output must be a supported JSON Schema: ${schemaIssues(mode.output).join('; ')}`);
  ensure(mode.projectOption === undefined || (typeof mode.projectOption === 'string' && options?.[mode.projectOption]?.type === 'string'), 'INVALID_PLUGIN', `${where} projectOption must name a declared string option.`);
}

/** Validates contributed metadata before registration; every problem is INVALID_PLUGIN. */
export function validateCommandMetadata(command: Record<string, unknown>): void {
  const where = `Command ${String(command.id)}`;
  ensure(text(command.description) && text(command.usage), 'INVALID_PLUGIN', `${where} requires a description and usage.`);
  ensure(command.options === undefined || isRecord(command.options), 'INVALID_PLUGIN', `${where} options must be an object.`);
  const options = (command.options ?? {}) as Record<string, unknown>;
  validateOptions(options);
  validateMode(command, where, options as CommandMetadata['options']);
  ensure(command.args === undefined || (Array.isArray(command.args) && command.args.every((arg: unknown, index, all) => isRecord(arg) && text(arg.name) && text(arg.description)
    && (arg.variadic === undefined || (arg.variadic === true && index === all.length - 1)) && documentSchema(arg.schema) && (arg.path === undefined || typeof arg.path === 'boolean'))), 'INVALID_PLUGIN', `${where} args must list named, described arguments with supported schemas and boolean path flags; only the last may be variadic.`);
  ensure(command.actions === undefined || isRecord(command.actions), 'INVALID_PLUGIN', `${where} actions must be an object.`);
  for (const [id, action] of Object.entries((command.actions ?? {}) as Record<string, unknown>)) {
    ensure(isRecord(action) && text(action.description) && (action.usage === undefined || text(action.usage)), 'INVALID_PLUGIN', `${where} action ${id} requires a description.`);
    ensure(action.options === undefined || isRecord(action.options), 'INVALID_PLUGIN', `${where} action ${id} options must be an object.`);
    validateOptions((action.options ?? {}) as Record<string, unknown>, options);
    validateMode(action, `${where} action ${id}`, { ...options, ...(action.options as object | undefined) } as CommandMetadata['options']);
  }
  ensure(command.defaultAction === undefined || (typeof command.defaultAction === 'string' && isRecord(command.actions) && Object.hasOwn(command.actions, command.defaultAction)), 'INVALID_PLUGIN', `${where} defaultAction must name a declared action.`);
  ensure(command.unknownAction === undefined || (unknownActionCodes.includes(command.unknownAction as UnknownActionCode) && isRecord(command.actions)), 'INVALID_PLUGIN', `${where} unknownAction must be ${unknownActionCodes.join(' or ')} for a command with actions.`);
  ensure(command.examples === undefined || (Array.isArray(command.examples) && command.examples.length >= 1 && command.examples.length <= 3
    && command.examples.every(example => typeof example === 'string' && (example === command.id || example.startsWith(`${String(command.id)} `)))), 'INVALID_PLUGIN', `${where} examples must list one to three invocations that start with the command id.`);
  ensure(command.errors === undefined || (Array.isArray(command.errors) && command.errors.every(code => typeof code === 'string' && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(code))), 'INVALID_PLUGIN', `${where} errors must list UPPER_SNAKE_CASE codes.`);
}
