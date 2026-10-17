import type { CommandFlags } from './command-metadata.ts';
import type { CommandContext } from './registry.ts';
/** The parser types of the global options, which every command accepts in addition to its own. */
export declare const globalOptions: {
    readonly root: "string";
    readonly lang: "string";
    readonly events: "string";
    readonly json: "boolean";
    readonly 'no-json': "boolean";
    readonly 'dry-run': "boolean";
    readonly 'no-dry-run': "boolean";
    readonly 'no-plugins': "boolean";
    readonly wait: "string";
    readonly help: "boolean";
    readonly version: "boolean";
};
/** The longest global `--wait` budget, in milliseconds (ten minutes). */
export declare const maximumWaitMs = 600000;
/** The MISSING_ARGUMENT message of an absent required option; a missing revision guard says where revisions come from. */
export declare function requiredOptionMessage(key: string): string;
/** A string option's value; `required` reports MISSING_ARGUMENT when it is absent. */
export declare function value(flags: CommandFlags, key: string, required?: boolean): string | undefined;
/** An integer option of at least `minimum`, or undefined when absent; other values are INVALID_ARGUMENT. */
export declare function integer(flags: CommandFlags, key: string, minimum?: number): number | undefined;
/** The global `--wait` budget: the milliseconds a write may wait for another Forge writer's lock, 0 when absent. */
export declare function waitBudget(flags: CommandFlags): number;
/**
 * Positional argument count check shared by every command; `details` `{minimum, maximum, received}` let the host
 * name the missing arguments and the usage from the command's metadata.
 */
export declare function arity(args: readonly string[], min: number, max?: number): void;
/** Selects raw input from exactly one of --from (read in the command's scope), --content or --stdin; callers own decoding. */
export declare function readInputBytes(flags: CommandFlags, context: Pick<CommandContext, 'workspace' | 'input'>, message: string): Promise<Uint8Array>;
/** Parses JSON input, ignoring a leading UTF-8 byte order mark (Windows PowerShell writes one); malformed input is INVALID_JSON. */
export declare function parseJson(text: string): unknown;
