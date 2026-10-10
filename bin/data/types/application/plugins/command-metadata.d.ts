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
 *   when it is omitted. A refinement inherits every field it does not set.
 * - `projectOption`: a string option that explicitly selects the project (`make ui --project web`).
 */
export type CommandScope = 'workspace' | 'project';
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
}
export interface CommandMetadata extends CommandMode {
    id: string;
    description: string;
    usage: string;
    options?: Readonly<Record<string, CommandOption>>;
    args?: readonly CommandArgument[];
    actions?: Readonly<Record<string, CommandAction>>;
    defaultAction?: string;
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
/** Option types for the argument parser. */
export declare function optionTypes(options: CommandMetadata['options']): Record<string, 'string' | 'boolean'>;
/**
 * JSON Schema 2020-12 of one invocation: `args` are the positional arguments after the command id and `options`
 * the command's own flags (global options are described once in the catalog).
 */
export declare function commandInputSchema(command: CommandMetadata): JsonSchema;
/** Annotations for agents: the resolved default mode plus each action's refinement. */
export declare function commandAnnotations(command: CommandMetadata): {
    actions?: {
        [k: string]: {
            projectOption?: string | undefined;
            description: string;
            scope: CommandScope;
            discovery: boolean;
            mutating: boolean;
            readOnlyHint: boolean;
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
