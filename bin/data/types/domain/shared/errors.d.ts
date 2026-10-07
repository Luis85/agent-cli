export declare class AppError extends Error {
    readonly code: string;
    readonly exitCode: number;
    readonly details?: Record<string, unknown> | undefined;
    constructor(code: string, message: string, exitCode?: number, details?: Record<string, unknown> | undefined);
}
/** Event diagnostics deliberately omit messages, input and arbitrary error details. */
export declare function summarizeError(error: unknown): {
    code: string;
    exitCode: number;
};
export declare function errorMessage(error: unknown): string;
export declare function ensure(condition: unknown, code: string, message: string): asserts condition;
export declare const isRecord: (value: unknown) => value is Record<string, unknown>;
