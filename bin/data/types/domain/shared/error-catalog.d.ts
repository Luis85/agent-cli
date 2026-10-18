/**
 * Single source of truth for built-in failure codes: the kernel's own, and the document and Claude Code file codecs
 * that several core plugins share. The category fixes the process exit status; `hint` names the next step an agent
 * or user should take and `retryable` says whether repeating the unchanged invocation later can succeed. A code only
 * one plugin raises belongs to that plugin's `errors` instead.
 */
export type ErrorCategory = 'input' | 'conflict' | 'not-found' | 'busy' | 'drift' | 'runtime' | 'external' | 'interrupted';
export interface ErrorDefinition {
    readonly exitCode: number;
    readonly category: ErrorCategory;
    readonly summary: string;
    readonly hint: string;
    readonly retryable: boolean;
    /** Hints for one occurrence, chosen by the first of `details[...details]` whose value names one; others use `hint`. */
    readonly variants?: HintVariants;
}
export interface HintVariants {
    readonly details: readonly string[];
    readonly hints: Readonly<Record<string, string>>;
}
/** SIGTERM interruptions report 143 instead of the category's SIGINT status 130. */
export declare const categoryExitCodes: {
    readonly input: 2;
    readonly conflict: 2;
    readonly 'not-found': 3;
    readonly busy: 4;
    readonly drift: 5;
    readonly runtime: 1;
    readonly external: 1;
    readonly interrupted: 130;
};
export declare const errorCatalog: {
    readonly SERVER_START_FAILED: ErrorDefinition;
    readonly SERVER_STOP_FAILED: ErrorDefinition;
    readonly SERVER_STATE_INVALID: ErrorDefinition;
    readonly SERVER_BUSY: ErrorDefinition;
    readonly UNKNOWN_COMMAND: ErrorDefinition;
    readonly UNKNOWN_OPTION: ErrorDefinition;
    readonly MISSING_ARGUMENT: ErrorDefinition;
    readonly INVALID_ARGUMENT: ErrorDefinition;
    readonly INVALID_OPTION_VALUE: ErrorDefinition;
    readonly DUPLICATE_OPTION: ErrorDefinition;
    readonly INVALID_INPUT: ErrorDefinition;
    readonly INPUT_REQUIRED: ErrorDefinition;
    readonly INVALID_JSON: ErrorDefinition;
    readonly INVALID_ENCODING: ErrorDefinition;
    readonly INVALID_LANGUAGE: ErrorDefinition;
    readonly INVALID_NAME: ErrorDefinition;
    readonly INVALID_KEY: ErrorDefinition;
    readonly INVALID_RESULT: ErrorDefinition;
    readonly OPERATION_FAILED: ErrorDefinition;
    readonly INVALID_PATH: ErrorDefinition;
    readonly UNSAFE_PATH: ErrorDefinition;
    readonly NOT_FOUND: ErrorDefinition;
    readonly CONFLICT: {
        readonly variants: {
            readonly details: readonly ["reason"];
            readonly hints: {
                readonly 'changed-while-planning': "A note linking to the moved path (error.details.path) changed while Forge planned the link updates, and nothing was written: rerun the same move; read that note first if you are editing it too.";
                readonly 'revision-required': "The request named error.details.path with an empty revision, so nothing was written: check that it is the file you mean to change or delete, then retry with error.details.currentRevision as --if-match (ifMatch in an apply plan); read, stat and a dry run report it too.";
            };
        };
        readonly exitCode: number;
        readonly category: ErrorCategory;
        readonly summary: string;
        readonly hint: string;
        readonly retryable: boolean;
    };
    readonly NO_MATCH: ErrorDefinition;
    readonly AMBIGUOUS_EDIT: ErrorDefinition;
    readonly UNSUPPORTED_EDIT: ErrorDefinition;
    readonly SECTION_NOT_FOUND: ErrorDefinition;
    readonly AMBIGUOUS_SECTION: ErrorDefinition;
    readonly INVALID_PLAN: ErrorDefinition;
    readonly WORKSPACE_BUSY: {
        readonly variants: {
            readonly details: readonly ["nestedWriter", "stale"];
            readonly hints: {
                readonly running: "A running writer of a nested root holds its lock (error.details.path) inside the folder this move or deletion would take along; --wait does not wait for it. Let that writer finish, then retry after error.details.retryAfterMs milliseconds or later.";
                readonly active: "The holder runs, or another running writer is removing a stale lock: retry after error.details.retryAfterMs milliseconds, or rerun with --wait <ms> to wait for the lock.";
                readonly unknown: "Forge cannot verify the holder (another host, pid namespace or boot, or an unreadable lock) and never removes its lock, so waiting does not help: confirm in error.details.lock that it no longer runs, inspect its unfinished changes, then delete the file named in error.details.path (relative to the workspace root) and retry.";
                readonly stale: "The holder provably no longer runs, but removing its lock failed: confirm no Forge process uses it, then delete the file named in error.details.path (relative to the workspace root) and retry.";
            };
        };
        readonly exitCode: number;
        readonly category: ErrorCategory;
        readonly summary: string;
        readonly hint: string;
        readonly retryable: boolean;
    };
    readonly DESTINATION_EXISTS: ErrorDefinition;
    readonly PROTECTED_PATH: ErrorDefinition;
    readonly INVALID_MOVE: ErrorDefinition;
    readonly HAS_BACKLINKS: ErrorDefinition;
    readonly ROLLBACK_FAILED: ErrorDefinition;
    readonly INVALID_FRONTMATTER: ErrorDefinition;
    readonly INVALID_YAML: ErrorDefinition;
    readonly INVALID_CANVAS: ErrorDefinition;
    readonly INVALID_BASE: ErrorDefinition;
    readonly INVALID_POINTER: ErrorDefinition;
    readonly INVALID_ROOT: ErrorDefinition;
    readonly INVALID_CONFIG: ErrorDefinition;
    readonly INVALID_SETUP: ErrorDefinition;
    readonly INVALID_PROJECT: ErrorDefinition;
    readonly INVALID_PROJECT_NAME: ErrorDefinition;
    readonly INVALID_PROJECT_CONTEXT: ErrorDefinition;
    readonly INVALID_COMPONENT_KIND: ErrorDefinition;
    readonly PROJECT_EXISTS: ErrorDefinition;
    readonly PROJECT_NOT_FOUND: ErrorDefinition;
    readonly PROJECT_REQUIRED: ErrorDefinition;
    readonly STALE_PROJECT_CONTEXT: ErrorDefinition;
    readonly UNKNOWN_GENERATOR: ErrorDefinition;
    readonly INVALID_GENERATION_PLAN: ErrorDefinition;
    readonly INVALID_GENERATION_REVISIONS: ErrorDefinition;
    readonly GENERATION_DRIFT: ErrorDefinition;
    readonly INVALID_WORKFLOW: ErrorDefinition;
    readonly WORKFLOW_DRIFT: ErrorDefinition;
    readonly INVALID_PLUGIN: ErrorDefinition;
    readonly INVALID_PLUGIN_CONFIG: ErrorDefinition;
    readonly INCOMPATIBLE_PLUGIN: ErrorDefinition;
    readonly DUPLICATE_PLUGIN: ErrorDefinition;
    readonly PLUGIN_NAMESPACE: ErrorDefinition;
    readonly PLUGIN_SERVICE_MISSING: ErrorDefinition;
    readonly PLUGIN_UNAVAILABLE: ErrorDefinition;
    readonly PLUGIN_SERVICE_CYCLE: ErrorDefinition;
    readonly PLUGIN_LIFECYCLE: ErrorDefinition;
    readonly DUPLICATE_OR_INVALID_ID: ErrorDefinition;
    readonly INVALID_EVENT: ErrorDefinition;
    readonly INVALID_EVENT_LISTENER: ErrorDefinition;
    readonly INVALID_EVENT_PAYLOAD: ErrorDefinition;
    readonly DUPLICATE_EVENT: ErrorDefinition;
    readonly UNKNOWN_EVENT: ErrorDefinition;
    readonly EVENT_RECURSION: ErrorDefinition;
    readonly EVENT_OWNERSHIP: ErrorDefinition;
    readonly INVALID_CLAUDE_AGENT: ErrorDefinition;
    readonly INVALID_CLAUDE_HOOKS: ErrorDefinition;
    readonly INVALID_CLAUDE_SETTINGS: ErrorDefinition;
};
export type ErrorCode = keyof typeof errorCatalog;
export declare const errorCodes: ErrorCode[];
export declare function errorDefinition(code: string): ErrorDefinition | undefined;
