import { type ErrorCode } from './error-catalog.ts';
/** Carries a stable code. Built-in failures use `forgeError` or `ensure`; other codes are plugin-defined. */
export declare class AppError extends Error {
    readonly code: string;
    readonly exitCode: number;
    readonly details?: Record<string, unknown> | undefined;
    constructor(code: string, message: string, exitCode?: number, details?: Record<string, unknown> | undefined);
}
/** Create a built-in failure whose exit status comes from the error catalog. Only signal interruptions override it. */
export declare function forgeError(code: ErrorCode, message: string, details?: Record<string, unknown>, exitCode?: number): AppError;
/** A failure with a plugin-registered code; its exit status comes from the plugin's error catalog entry. */
export declare function codedError(code: string, message: string, exitCode: number, details?: Record<string, unknown>): AppError;
/** Event diagnostics deliberately omit messages, input and arbitrary error details. */
export declare function summarizeError(error: unknown): {
    code: string;
    exitCode: number;
};
export declare function errorMessage(error: unknown): string;
export declare function ensure(condition: unknown, code: ErrorCode, message: string, details?: Record<string, unknown>): asserts condition;
export declare const isRecord: (value: unknown) => value is Record<string, unknown>;
