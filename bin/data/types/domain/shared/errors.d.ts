import { type ErrorCode } from './error-catalog.ts';
/**
 * Carries a stable code. Built-in failures use `forgeError` or `ensure`; other codes are plugin-defined. `retryable`
 * overrides the catalog's retryability when this occurrence knows better (a lock whose holder cannot be verified).
 */
export declare class AppError extends Error {
    readonly code: string;
    readonly exitCode: number;
    readonly details?: Record<string, unknown> | undefined;
    readonly retryable?: boolean | undefined;
    constructor(code: string, message: string, exitCode?: number, details?: Record<string, unknown> | undefined, retryable?: boolean | undefined);
}
/**
 * Create a built-in failure whose exit status comes from the error catalog. Only signal interruptions override it;
 * `retryable` overrides the catalog's retryability for this occurrence.
 */
export declare function forgeError(code: ErrorCode, message: string, details?: Record<string, unknown>, exitCode?: number, retryable?: boolean): AppError;
/** A failure with a plugin-registered code; its exit status comes from the plugin's error catalog entry. */
export declare function codedError(code: string, message: string, exitCode: number, details?: Record<string, unknown>): AppError;
/** The same failure located inside a larger request: its message gains `prefix` and its details gain `details`. */
export declare function locatedError(error: AppError, prefix: string, details: Record<string, unknown>): AppError;
/** The same failure restated for another frame of reference, such as paths relative to a narrower scope. */
export declare function restatedError(error: AppError, message: string, details: Record<string, unknown> | undefined): AppError;
/** Event diagnostics deliberately omit messages, input and arbitrary error details. */
export declare function summarizeError(error: unknown): {
    code: string;
    exitCode: number;
};
export declare function errorMessage(error: unknown): string;
export declare function ensure(condition: unknown, code: ErrorCode, message: string, details?: Record<string, unknown>): asserts condition;
export declare const isRecord: (value: unknown) => value is Record<string, unknown>;
/** The code of a coded failure: a host error, or a plugin `Error` with a string `code` before the host mapped it. */
export declare function failureCode(error: unknown): string | undefined;
