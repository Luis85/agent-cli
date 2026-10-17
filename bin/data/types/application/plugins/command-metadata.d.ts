import { type JsonSchema } from '../../domain/schema/json-schema.ts';
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
declare const unknownActionCodes: readonly ["UNKNOWN_GENERATOR", "INVALID_ARGUMENT"];
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
    type: 'string' | 'boolean';
    description: string;
    enum?: readonly string[];
    list?: boolean;
    default?: string | boolean;
    required?: boolean;
    schema?: JsonSchema;
    path?: boolean;
}
export interface CommandArgument {
    name: string;
    description: string;
    required?: boolean;
    enum?: readonly string[];
    variadic?: boolean;
    schema?: JsonSchema;
    path?: boolean;
}
export interface CommandMode {
    scope?: CommandScope;
    discovery?: boolean;
    mutating?: boolean;
    projectOption?: string;
    destructive?: boolean;
    idempotent?: boolean;
}
export interface CommandAction extends CommandMode {
    description: string;
    usage?: string;
    /** Options accepted only with this action, besides the command's own; names never repeat a command option. */
    options?: Readonly<Record<string, CommandOption>>;
    /** JSON Schema of `data` for this action; overrides the command's `output`. */
    output?: JsonSchema;
}
export interface CommandMetadata extends CommandMode {
    id: string;
    description: string;
    usage: string;
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
export interface ResolvedMode {
    action?: string;
    scope: CommandScope;
    discovery: boolean;
    mutating: boolean;
    projectOption?: string;
}
/** Option schema builders for command definitions. */
export declare const option: {
    string: (description: string, extra?: Omit<CommandOption, "type" | "description">) => CommandOption;
    boolean: (description: string, extra?: Omit<CommandOption, "type" | "description">) => CommandOption;
};
/** The mode an invocation runs in: the action refinement for the first argument, over the command's own fields. */
export declare function commandMode(command: CommandMetadata, args: readonly string[]): ResolvedMode;
/** The options an invocation accepts: the command's own plus those of the action its arguments select. */
export declare function commandOptions(command: CommandMetadata, args: readonly string[]): Record<string, CommandOption>;
/** Whether parsing must resolve the action first: some action declares its own options, or unknown actions fail. */
export declare function hasActionOptions(command: CommandMetadata): boolean;
/**
 * The options the first parsing pass knows, so that options before or between the action words cannot hide the
 * action: the command's own and every action's, except names that actions declare with different types.
 */
export declare function anyActionOptions(command: CommandMetadata): Record<string, 'string' | 'boolean'>;
/**
 * Fails with the command's `unknownAction` code when the leading arguments (not options) select no declared action.
 * The message lists the declared actions, which `details.allowed` holds with the closest in `details.suggestions`.
 */
export declare function ensureKnownAction(command: CommandMetadata, args: readonly string[]): void;
/** Option types for the argument parser. */
export declare function optionTypes(options: CommandMetadata['options']): Record<string, 'string' | 'boolean'>;
/** The items of a `list` option's value: comma-separated, with whitespace around each item ignored. */
export declare function listOptionItems(value: string): string[];
/**
 * JSON Schema 2020-12 of one invocation: `args` are the positional arguments after the command id and `options`
 * the command's own flags (global options are described once in the catalog). A command with actions publishes
 * one `oneOf` branch per action, keyed by the words of its id as `const` leading arguments, with that action's
 * options and required options; when the first argument is optional, a further branch without arguments covers
 * the default action.
 */
export declare function commandInputSchema(command: CommandMetadata): JsonSchema;
/** A declared output schema as a standalone JSON Schema 2020-12 document. */
export declare const outputDocument: (title: string, schema: JsonSchema) => JsonSchema;
/**
 * The published schema of `data` in a successful response to one invocation: the selected action's own `output`,
 * else the command's, or `undefined` when neither declares one.
 */
export declare function commandOutputSchema(command: CommandMetadata, args: readonly string[]): JsonSchema | undefined;
/**
 * Annotations for agents: the default mode's scope and discovery, plus each action's refinement. `mutating` (and
 * `readOnlyHint`, its negation) covers every mode, so a command is read-only only when none of its actions mutates;
 * `destructiveHint` holds when any mode is destructive and `idempotentHint` only when every mode is idempotent.
 */
export declare function commandAnnotations(command: CommandMetadata): {
    actions?: {
        [k: string]: {
            outputSchema?: JsonSchema | undefined;
            options?: Readonly<Record<string, CommandOption>> | undefined;
            projectOption?: string | undefined;
            readOnlyHint: boolean;
            destructiveHint: boolean;
            idempotentHint: boolean;
            scope: CommandScope;
            discovery: boolean;
            mutating: boolean;
            usage?: string | undefined;
            description: string;
        };
    } | undefined;
    defaultAction?: string | undefined;
    scope: CommandScope;
    discovery: boolean;
    mutating: boolean;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
};
/** Validates contributed metadata before registration; every problem is INVALID_PLUGIN. */
export declare function validateCommandMetadata(command: Record<string, unknown>): void;
export {};
