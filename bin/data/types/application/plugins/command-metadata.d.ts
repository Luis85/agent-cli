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
 * - `actions`: refinements keyed by the first positional argument (`skills install`), with `defaultAction` used
 *   when it is omitted. A refinement inherits every field it does not set and may add its own `options`, which
 *   the parser accepts only for that action (`make <generator>`).
 * - `unknownAction`: the code for a first argument that names no declared action, `UNKNOWN_GENERATOR` or
 *   `INVALID_ARGUMENT`. It outranks option errors, so options of an unknown action never read as `UNKNOWN_OPTION`.
 * - `projectOption`: a string option that explicitly selects the project (`make ui --project web`).
 */
export type CommandScope = 'workspace' | 'project';
declare const unknownActionCodes: readonly ["UNKNOWN_GENERATOR", "INVALID_ARGUMENT"];
export type UnknownActionCode = typeof unknownActionCodes[number];
export type CommandFlags = Record<string, string | boolean>;
export interface CommandOption {
    type: 'string' | 'boolean';
    description: string;
    enum?: readonly string[];
    default?: string | boolean;
    required?: boolean;
}
export interface CommandArgument {
    name: string;
    description: string;
    required?: boolean;
    enum?: readonly string[];
    variadic?: boolean;
}
export interface CommandMode {
    scope?: CommandScope;
    discovery?: boolean;
    mutating?: boolean;
    projectOption?: string;
}
export interface CommandAction extends CommandMode {
    description: string;
    usage?: string;
    /** Options accepted only with this action, besides the command's own; names never repeat a command option. */
    options?: Readonly<Record<string, CommandOption>>;
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
    /** Optional JSON Schema of `data` in a successful response. */
    output?: JsonSchema;
    /** Failure codes the command reports itself, beyond the input and routing codes every command can raise. */
    errors?: readonly string[];
}
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
/** Fails with the command's `unknownAction` code when the first argument (not an option) names no declared action. */
export declare function ensureKnownAction(command: CommandMetadata, args: readonly string[]): void;
/** Option types for the argument parser. */
export declare function optionTypes(options: CommandMetadata['options']): Record<string, 'string' | 'boolean'>;
/**
 * JSON Schema 2020-12 of one invocation: `args` are the positional arguments after the command id and `options`
 * the command's own flags (global options are described once in the catalog). A command with actions publishes
 * one `oneOf` branch per action, keyed by the first argument as a `const`, with that action's options and required
 * options; when the first argument is optional, a further branch without arguments covers the default action.
 */
export declare function commandInputSchema(command: CommandMetadata): JsonSchema;
/**
 * Annotations for agents: the default mode's scope and discovery, plus each action's refinement. `mutating` (and
 * `readOnlyHint`, its negation) covers every mode, so a command is read-only only when none of its actions mutates.
 */
export declare function commandAnnotations(command: CommandMetadata): {
    actions?: {
        [k: string]: {
            options?: Readonly<Record<string, CommandOption>> | undefined;
            projectOption?: string | undefined;
            scope: CommandScope;
            discovery: boolean;
            mutating: boolean;
            readOnlyHint: boolean;
            usage?: string | undefined;
            description: string;
        };
    } | undefined;
    defaultAction?: string | undefined;
    scope: CommandScope;
    discovery: boolean;
    mutating: boolean;
    readOnlyHint: boolean;
};
/** Validates contributed metadata before registration; every problem is INVALID_PLUGIN. */
export declare function validateCommandMetadata(command: Record<string, unknown>): void;
export {};
