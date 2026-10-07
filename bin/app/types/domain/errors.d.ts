export declare class AppError extends Error {
    readonly code: string;
    readonly exitCode: number;
    constructor(code: string, message: string, exitCode?: number);
}
export declare function ensure(condition: unknown, code: string, message: string): asserts condition;
export declare const isRecord: (value: unknown) => value is Record<string, unknown>;
