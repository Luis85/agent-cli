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
 *   action (`make <generator>`), and declares its own `args`, the positional arguments after its words.
 * - `args`: the positional arguments, which the host counts before the command runs (see `argumentBounds`). On a
 *   command with actions they are those of an invocation that spells no action, so `[{ name: 'action', required:
 *   true }]` makes the action required; with `unknownAction`, only an invocation without arguments spells none.
 *   Undeclared `args` leave the count of that invocation unchecked.
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
/**
 * A positional argument. Required arguments precede optional ones, and only the last may be `variadic`: it then
 * takes one or more values (none when it is optional), at most `maximum` of them when that is set.
 */
export interface CommandArgument {
  name: string; description: string; required?: boolean; enum?: readonly string[]; variadic?: boolean; maximum?: number; schema?: JsonSchema; path?: boolean;
}
const documentSchema = (value: unknown) => value === undefined || schemaIssues(value).length === 0;
export interface CommandMode {
  scope?: CommandScope; discovery?: boolean; mutating?: boolean; projectOption?: string;
  destructive?: boolean; idempotent?: boolean;
}
export interface CommandAction extends CommandMode {
  description: string; usage?: string;
  /** Options accepted only with this action, besides the command's own; names never repeat a command option. */
  options?: Readonly<Record<string, CommandOption>>;
  /** The positional arguments after the action's words; undeclared, their count is unchecked. */
  args?: readonly CommandArgument[];
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
  /** The actions are registered generators (`make`): their descriptions translate by generator id. */
  generatorActions?: boolean;
  /** Optional JSON Schema of `data` in a successful response. */
  output?: JsonSchema;
  /** Failure codes the command reports itself, beyond the input and routing codes every command can raise. */
  errors?: readonly string[];
  /** One to three invocations after `forge`, each starting with the command id; examples are not translated. */
  examples?: readonly string[];
  /** Which top-level fields of a successful result `--lang` translates, and how; results are otherwise never translated. */
  localizedOutput?: Readonly<Record<string, OutputLocalization>>;
}
/**
 * How the response language rewrites one result field: `text` translates English guidance by its text wherever the
 * value holds it (a string, or strings inside arrays and objects); `generators` and `events` translate the
 * `description` of `[{id, description}]` entries by id; `errors` the `summary` of `[{code, summary}]` entries by
 * code; `options` the descriptions of an option metadata object; `settings` the descriptions inside the `schema` of
 * `[{schema}]` sections. A value of another shape stays unchanged.
 */
export type OutputLocalization = 'text' | 'generators' | 'events' | 'errors' | 'options' | 'settings';
const outputLocalizations: readonly OutputLocalization[] = ['text', 'generators', 'events', 'errors', 'options', 'settings'];
/** The words of an action id: `iteration add` selects the arguments `iteration`, `add`. */
export const actionWords = (id: string): string[] => id.split(' ');

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

/** The positional arguments an invocation is counted against: `words` action words, then `args`. */
export interface DeclaredArguments { action?: string; words: number; args: readonly CommandArgument[] }

/**
 * The declared positional arguments of an invocation: those of the action its leading arguments spell, after its
 * words, else the command's own. `undefined` when they are not declared, so their count goes unchecked.
 */
export function declaredArguments(command: CommandMetadata, args: readonly string[]): DeclaredArguments | undefined {
  const action = args.length === 0 ? undefined : actionId(command, args);
  const declared = action === undefined ? command.args : command.actions?.[action]?.args;
  if (declared === undefined) return undefined;
  return action === undefined ? { words: 0, args: declared } : { action, words: actionWords(action).length, args: declared };
}

/**
 * The fewest and most positional arguments of an invocation, its action words included: the required arguments,
 * and every argument or, for a variadic last one, its `maximum` values; no `maximum` when a variadic one has none.
 */
export function argumentBounds({ words, args }: DeclaredArguments): { minimum: number; maximum?: number } {
  const last = args.at(-1), minimum = words + args.filter(arg => arg.required).length;
  if (last?.variadic !== true) return { minimum, maximum: words + args.length };
  return last.maximum === undefined ? { minimum } : { minimum, maximum: words + args.length - 1 + last.maximum };
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
 * Fails with the command's `unknownAction` code when the leading arguments (not options) select no declared action,
 * or follow an action without arguments of its own with a word that spells none of its sub-actions. The message
 * lists the declared actions, which `details.allowed` holds with the closest in `details.suggestions`.
 */
export function ensureKnownAction(command: CommandMetadata, args: readonly string[]): void {
  const action = args[0];
  if (command.unknownAction === undefined || action === undefined || action.startsWith('-')) return;
  const id = actionId(command, args);
  if (id !== undefined) {
    // An action that takes no arguments of its own spells a sub-action with the next one: `claude agents lst`.
    const next = args[actionWords(id).length];
    if (next !== undefined && command.actions?.[id]?.args?.length === 0 && nextWords(command, actionWords(id)).length > 0) unknownAction(command.unknownAction, command, `${id} ${next}`);
    return;
  }
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
 * `args` and `options` of one invocation shape: the words of `action` as leading `const` arguments, then the
 * declared arguments, counted by `argumentBounds`; the argument after the words never spells one of `excluded`, the
 * next words of the longer action ids. Undeclared arguments are any number of strings.
 */
function invocationSchema(usage: string, declared: DeclaredArguments | undefined, options: Readonly<Record<string, CommandOption>>, action?: string, excluded: readonly string[] = []): JsonSchema {
  const required = Object.entries(options).filter(([, schema]) => schema.required).map(([key]) => key);
  const words = action === undefined ? [] : actionWords(action), args = declared?.args ?? [];
  const positional: JsonSchema[] = [...words.map(word => ({ type: 'string' as const, const: word })), ...args.map(positionalSchema)];
  const rest = args.at(-1)?.variadic ? positional.at(-1)! : { type: 'string' as const };
  const bounds = declared === undefined ? { minimum: words.length } : argumentBounds(declared);
  if (excluded.length > 0 && (bounds.maximum === undefined || bounds.maximum > words.length)) positional[words.length] = { ...(positional[words.length] ?? rest), pattern: exceptWords(excluded) };
  return {
    type: 'object', additionalProperties: false, required: ['args', 'options'],
    properties: {
      args: {
        type: 'array', description: usage, items: rest,
        ...(positional.length > 0 ? { prefixItems: positional } : {}),
        minItems: bounds.minimum, ...(bounds.maximum === undefined ? {} : { maxItems: bounds.maximum }),
      },
      options: {
        type: 'object', additionalProperties: false,
        properties: Object.fromEntries(Object.entries(options).map(([key, schema]) => [key, optionSchema(schema)])),
        ...(required.length > 0 ? { required } : {}),
      },
    },
  };
}

/** The next words after `prefix` of the action ids that extend it: the first words of all ids for an empty prefix. */
function nextWords(command: CommandMetadata, prefix: readonly string[]): string[] {
  const extending = Object.keys(command.actions ?? {}).map(actionWords).filter(words => words.length > prefix.length && prefix.every((word, index) => words[index] === word));
  return [...new Set(extending.map(words => words[prefix.length]!))];
}

/**
 * An action's usage: its declared `usage`, else, when it declares `args`, the command id, the action words, its
 * arguments (`<required>`, `[optional]`, `name...` when variadic) and its own options, optional ones in brackets;
 * otherwise the command's.
 */
export function actionUsage(command: CommandMetadata, id: string): string {
  const action = command.actions?.[id];
  if (action?.usage !== undefined || action?.args === undefined) return action?.usage ?? command.usage;
  const args = action.args.map(arg => `${arg.required ? '<' : '['}${arg.name}${arg.variadic ? '...' : ''}${arg.required ? '>' : ']'}`);
  const options = Object.entries(action.options ?? {}).map(([key, schema]) => {
    const flag = `--${key}${schema.type === 'string' ? ` ${schema.enum?.join('|') ?? 'value'}` : ''}`;
    return schema.required ? flag : `[${flag}]`;
  });
  return [command.id, id, ...args, ...options].join(' ');
}

/**
 * JSON Schema 2020-12 of one invocation: `args` are the positional arguments after the command id and `options`
 * the command's own flags (global options are described once in the catalog). A command with actions publishes
 * one `oneOf` branch per action, keyed by the words of its id as `const` leading arguments and followed by the
 * action's own `args`, with that action's options and required options. A further branch covers the invocation
 * that spells no action, with the command's `args`: with `unknownAction` only the invocation without arguments,
 * unless an argument is required, and otherwise one whose first argument is no action word.
 */
export function commandInputSchema(command: CommandMetadata): JsonSchema {
  const head = { $schema: jsonSchemaDialect, title: command.id, description: command.description };
  const own = command.args && { words: 0, args: command.args };
  if (!command.actions) return { ...head, ...invocationSchema(command.usage, own, command.options ?? {}) };
  const branches = Object.entries(command.actions).map(([id, action]): JsonSchema => ({
    title: `${command.id} ${id}`, description: action.description,
    ...invocationSchema(actionUsage(command, id), action.args && { words: actionWords(id).length, args: action.args }, { ...command.options, ...action.options }, id, nextWords(command, actionWords(id))),
  }));
  const bare = command.unknownAction !== undefined;
  const omitted: JsonSchema[] = bare && command.args?.some(arg => arg.required) ? [] : [{
    title: command.defaultAction === undefined ? command.id : `${command.id} (${command.defaultAction})`,
    description: command.defaultAction === undefined ? command.description : command.actions[command.defaultAction]!.description,
    ...invocationSchema(command.usage, bare ? { words: 0, args: [] } : own, commandOptions(command, []), undefined, bare ? [] : nextWords(command, [])),
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
        description: action.description, ...(action.usage !== undefined || action.args !== undefined ? { usage: actionUsage(command, id) } : {}),
        ...(action.args ? { args: action.args } : {}),
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

/** Whether one declared argument is well formed; `last` allows `variadic` and its `maximum`. */
function validArgument(arg: unknown, last: boolean): boolean {
  if (!isRecord(arg) || !text(arg.name) || !text(arg.description)) return false;
  const flags = ['required', 'variadic', 'path'].every(key => arg[key] === undefined || typeof arg[key] === 'boolean');
  const values = arg.enum === undefined || (Array.isArray(arg.enum) && arg.enum.length > 0 && arg.enum.every(item => typeof item === 'string'));
  const variadic = arg.variadic !== true || last;
  const maximum = arg.maximum === undefined || (arg.variadic === true && typeof arg.maximum === 'number' && Number.isSafeInteger(arg.maximum) && arg.maximum >= 1);
  return flags && values && variadic && maximum && documentSchema(arg.schema);
}
function validateArguments(args: unknown, where: string): void {
  ensure(args === undefined || (Array.isArray(args) && args.every((arg: unknown, index) => validArgument(arg, index === args.length - 1))
    && args.every((arg, index) => !(arg as CommandArgument).required || args.slice(0, index).every(before => (before as CommandArgument).required))), 'INVALID_PLUGIN',
  `${where} args must list named, described arguments with boolean required, variadic and path flags, string enums and supported schemas; required arguments come first, and only the last may be variadic, with a positive integer maximum.`);
}

/** Validates contributed metadata before registration; every problem is INVALID_PLUGIN. */
export function validateCommandMetadata(command: Record<string, unknown>): void {
  const where = `Command ${String(command.id)}`;
  ensure(text(command.description) && text(command.usage), 'INVALID_PLUGIN', `${where} requires a description and usage.`);
  ensure(command.options === undefined || isRecord(command.options), 'INVALID_PLUGIN', `${where} options must be an object.`);
  const options = (command.options ?? {}) as Record<string, unknown>;
  validateOptions(options);
  validateMode(command, where, options as CommandMetadata['options']);
  validateArguments(command.args, where);
  ensure(command.actions === undefined || isRecord(command.actions), 'INVALID_PLUGIN', `${where} actions must be an object.`);
  for (const [id, action] of Object.entries((command.actions ?? {}) as Record<string, unknown>)) {
    ensure(isRecord(action) && text(action.description) && (action.usage === undefined || text(action.usage)), 'INVALID_PLUGIN', `${where} action ${id} requires a description.`);
    ensure(action.options === undefined || isRecord(action.options), 'INVALID_PLUGIN', `${where} action ${id} options must be an object.`);
    validateOptions((action.options ?? {}) as Record<string, unknown>, options);
    validateMode(action, `${where} action ${id}`, { ...options, ...(action.options as object | undefined) } as CommandMetadata['options']);
    validateArguments(action.args, `${where} action ${id}`);
  }
  ensure(command.defaultAction === undefined || (typeof command.defaultAction === 'string' && isRecord(command.actions) && Object.hasOwn(command.actions, command.defaultAction)), 'INVALID_PLUGIN', `${where} defaultAction must name a declared action.`);
  ensure(command.unknownAction === undefined || (unknownActionCodes.includes(command.unknownAction as UnknownActionCode) && isRecord(command.actions)), 'INVALID_PLUGIN', `${where} unknownAction must be ${unknownActionCodes.join(' or ')} for a command with actions.`);
  ensure(command.examples === undefined || (Array.isArray(command.examples) && command.examples.length >= 1 && command.examples.length <= 3
    && command.examples.every(example => typeof example === 'string' && (example === command.id || example.startsWith(`${String(command.id)} `)))), 'INVALID_PLUGIN', `${where} examples must list one to three invocations that start with the command id.`);
  ensure(command.generatorActions === undefined || typeof command.generatorActions === 'boolean', 'INVALID_PLUGIN', `${where} generatorActions must be a boolean.`);
  ensure(command.localizedOutput === undefined || (isRecord(command.localizedOutput) && Object.values(command.localizedOutput).every(kind => outputLocalizations.includes(kind as OutputLocalization))), 'INVALID_PLUGIN', `${where} localizedOutput must map result fields to ${outputLocalizations.join(', ')}.`);
  ensure(command.errors === undefined || (Array.isArray(command.errors) && command.errors.every(code => typeof code === 'string' && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(code))), 'INVALID_PLUGIN', `${where} errors must list UPPER_SNAKE_CASE codes.`);
}
