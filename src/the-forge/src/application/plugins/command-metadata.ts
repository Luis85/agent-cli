import { ensure, isRecord } from '../../domain/shared/errors.ts';
import { jsonSchemaDialect, schemaIssues, type JsonSchema } from '../../domain/schema/json-schema.ts';

/**
 * Declarative command metadata. One description drives argument parsing, the invocation policy (scope and plugin
 * activation), `help`, and the JSON Schema that `schema` publishes; commands never repeat it in code.
 *
 * - `scope`: `project` runs in the selected project (the workspace when none is selected); `workspace` always runs
 *   at the workspace root. Default `project`.
 * - `discovery`: a discovery or recovery command runs at workspace scope without activating plugins, so a stale
 *   selection or a failing plugin `onload` cannot block it. Default `false`.
 * - `mutating`: whether the command can change files or external state. Default `true` for undeclared commands.
 * - `actions`: refinements keyed by the first positional argument (`skills install`), with `defaultAction` used
 *   when it is omitted. A refinement inherits every field it does not set.
 * - `projectOption`: a string option that explicitly selects the project (`make ui --project web`).
 */
export type CommandScope = 'workspace' | 'project';
export type CommandFlags = Record<string, string | boolean>;
export interface CommandOption {
  type: 'string' | 'boolean'; description: string;
  enum?: readonly string[]; default?: string | boolean; required?: boolean;
}
export interface CommandArgument { name: string; description: string; required?: boolean; enum?: readonly string[]; variadic?: boolean }
export interface CommandMode { scope?: CommandScope; discovery?: boolean; mutating?: boolean; projectOption?: string }
export interface CommandAction extends CommandMode { description: string }
export interface CommandMetadata extends CommandMode {
  id: string; description: string; usage: string;
  options?: Readonly<Record<string, CommandOption>>;
  args?: readonly CommandArgument[];
  actions?: Readonly<Record<string, CommandAction>>;
  defaultAction?: string;
  /** Optional JSON Schema of `data` in a successful response. */
  output?: JsonSchema;
  /** Failure codes the command reports itself, beyond the input and routing codes every command can raise. */
  errors?: readonly string[];
}
export interface ResolvedMode { action?: string; scope: CommandScope; discovery: boolean; mutating: boolean; projectOption?: string }

/** Option schema builders for command definitions. */
export const option = {
  string: (description: string, extra: Omit<CommandOption, 'type' | 'description'> = {}): CommandOption => ({ type: 'string', description, ...extra }),
  boolean: (description: string, extra: Omit<CommandOption, 'type' | 'description'> = {}): CommandOption => ({ type: 'boolean', description, ...extra }),
};

/** The mode an invocation runs in: the action refinement for the first argument, over the command's own fields. */
export function commandMode(command: CommandMetadata, args: readonly string[]): ResolvedMode {
  const action = args[0] ?? command.defaultAction;
  const refined = action !== undefined && command.actions && Object.hasOwn(command.actions, action) ? command.actions[action] : undefined;
  const projectOption = refined?.projectOption ?? command.projectOption;
  return {
    ...(refined ? { action } : {}),
    scope: refined?.scope ?? command.scope ?? 'project',
    discovery: refined?.discovery ?? command.discovery ?? false,
    mutating: refined?.mutating ?? command.mutating ?? true,
    ...(projectOption === undefined ? {} : { projectOption }),
  };
}

/** Option types for the argument parser. */
export function optionTypes(options: CommandMetadata['options']): Record<string, 'string' | 'boolean'> {
  return Object.fromEntries(Object.entries(options ?? {}).map(([key, schema]) => [key, schema.type]));
}

function optionSchema(schema: CommandOption): JsonSchema {
  return { type: schema.type, description: schema.description, ...(schema.enum ? { enum: [...schema.enum] } : {}), ...(schema.default === undefined ? {} : { default: schema.default }) };
}

/**
 * JSON Schema 2020-12 of one invocation: `args` are the positional arguments after the command id and `options`
 * the command's own flags (global options are described once in the catalog).
 */
export function commandInputSchema(command: CommandMetadata): JsonSchema {
  const args = command.args ?? [];
  const required = Object.entries(command.options ?? {}).filter(([, schema]) => schema.required).map(([key]) => key);
  const variadic = args.at(-1)?.variadic === true;
  const positional = args.map(arg => ({ type: 'string' as const, description: arg.description, ...(arg.enum ? { enum: [...arg.enum] } : {}) }));
  return {
    $schema: jsonSchemaDialect, title: command.id, description: command.description, type: 'object', additionalProperties: false,
    properties: {
      args: {
        type: 'array', description: command.usage, items: variadic ? positional.at(-1)! : { type: 'string' },
        ...(positional.length > 0 ? { prefixItems: positional } : {}),
        minItems: args.filter(arg => arg.required).length, ...(variadic ? {} : { maxItems: args.length }),
      },
      options: {
        type: 'object', additionalProperties: false,
        properties: Object.fromEntries(Object.entries(command.options ?? {}).map(([key, schema]) => [key, optionSchema(schema)])),
        ...(required.length > 0 ? { required } : {}),
      },
    },
    required: ['args', 'options'],
  };
}

/** Annotations for agents: the resolved default mode plus each action's refinement. */
export function commandAnnotations(command: CommandMetadata) {
  const { scope, discovery, mutating } = commandMode(command, []);
  return {
    scope, discovery, mutating, readOnlyHint: !mutating,
    ...(command.defaultAction === undefined ? {} : { defaultAction: command.defaultAction }),
    ...(command.actions ? { actions: Object.fromEntries(Object.entries(command.actions).map(([id, action]) => {
      const mode = commandMode(command, [id]);
      return [id, { description: action.description, scope: mode.scope, discovery: mode.discovery, mutating: mode.mutating, readOnlyHint: !mode.mutating, ...(mode.projectOption ? { projectOption: mode.projectOption } : {}) }];
    })) } : {}),
  };
}

const reservedOptions = ['root', 'lang', 'events', 'json', 'no-json', 'dry-run', 'no-dry-run', 'no-plugins', 'help', 'version'];
const flag = /^[a-z][a-z0-9-]*$/;
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
function validateMode(mode: Record<string, unknown>, where: string, options: CommandMetadata['options']): void {
  ensure(mode.scope === undefined || mode.scope === 'workspace' || mode.scope === 'project', 'INVALID_PLUGIN', `${where} scope must be workspace or project.`);
  for (const key of ['discovery', 'mutating']) ensure(mode[key] === undefined || typeof mode[key] === 'boolean', 'INVALID_PLUGIN', `${where} ${key} must be a boolean.`);
  ensure(mode.projectOption === undefined || (typeof mode.projectOption === 'string' && options?.[mode.projectOption]?.type === 'string'), 'INVALID_PLUGIN', `${where} projectOption must name a declared string option.`);
}

/** Validates contributed metadata before registration; every problem is INVALID_PLUGIN. */
export function validateCommandMetadata(command: Record<string, unknown>): void {
  const where = `Command ${String(command.id)}`;
  ensure(text(command.description) && text(command.usage), 'INVALID_PLUGIN', `${where} requires a description and usage.`);
  ensure(command.options === undefined || isRecord(command.options), 'INVALID_PLUGIN', `${where} options must be an object.`);
  const options = (command.options ?? {}) as Record<string, unknown>;
  for (const [key, schema] of Object.entries(options)) {
    ensure(flag.test(key) && !reservedOptions.includes(key), 'INVALID_PLUGIN', `Invalid command option ${key}.`);
    ensure(isRecord(schema) && (schema.type === 'string' || schema.type === 'boolean') && text(schema.description), 'INVALID_PLUGIN', `Command option ${key} requires type string or boolean and a description.`);
    ensure(schema.enum === undefined || (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every(item => typeof item === 'string')), 'INVALID_PLUGIN', `Command option ${key} enum must list strings.`);
    ensure(schema.default === undefined || typeof schema.default === schema.type, 'INVALID_PLUGIN', `Command option ${key} default must match its type.`);
    ensure(schema.required === undefined || typeof schema.required === 'boolean', 'INVALID_PLUGIN', `Command option ${key} required must be a boolean.`);
  }
  validateMode(command, where, options as CommandMetadata['options']);
  ensure(command.args === undefined || (Array.isArray(command.args) && command.args.every((arg: unknown, index, all) => isRecord(arg) && text(arg.name) && text(arg.description)
    && (arg.variadic === undefined || (arg.variadic === true && index === all.length - 1)))), 'INVALID_PLUGIN', `${where} args must list named, described arguments; only the last may be variadic.`);
  ensure(command.actions === undefined || isRecord(command.actions), 'INVALID_PLUGIN', `${where} actions must be an object.`);
  for (const [id, action] of Object.entries((command.actions ?? {}) as Record<string, unknown>)) {
    ensure(isRecord(action) && text(action.description), 'INVALID_PLUGIN', `${where} action ${id} requires a description.`);
    validateMode(action, `${where} action ${id}`, options as CommandMetadata['options']);
  }
  ensure(command.defaultAction === undefined || (typeof command.defaultAction === 'string' && isRecord(command.actions) && Object.hasOwn(command.actions, command.defaultAction)), 'INVALID_PLUGIN', `${where} defaultAction must name a declared action.`);
  ensure(command.output === undefined || schemaIssues(command.output).length === 0, 'INVALID_PLUGIN', `${where} output must be a supported JSON Schema: ${schemaIssues(command.output).join('; ')}`);
  ensure(command.errors === undefined || (Array.isArray(command.errors) && command.errors.every(code => typeof code === 'string' && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(code))), 'INVALID_PLUGIN', `${where} errors must list UPPER_SNAKE_CASE codes.`);
}
