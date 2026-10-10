import { errorCatalog, type ErrorCode } from './error-catalog.ts';

/** Carries a stable code. Built-in failures use `forgeError` or `ensure`; other codes are plugin-defined. */
export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly exitCode = 1, public readonly details?: Record<string, unknown>) {
    super(message);
  }
}
/** Create a built-in failure whose exit status comes from the error catalog. Only signal interruptions override it. */
export function forgeError(code: ErrorCode, message: string, details?: Record<string, unknown>, exitCode: number = errorCatalog[code].exitCode): AppError {
  return new AppError(code, message, exitCode, details);
}
/** Event diagnostics deliberately omit messages, input and arbitrary error details. */
export function summarizeError(error: unknown): { code: string; exitCode: number } {
  return error instanceof AppError ? { code: error.code, exitCode: error.exitCode } : { code: 'OPERATION_FAILED', exitCode: errorCatalog.OPERATION_FAILED.exitCode };
}
export function errorMessage(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error); }
  catch { return 'Operation failed with an unreadable error.'; }
}
export function ensure(condition: unknown, code: ErrorCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw forgeError(code, message, details);
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
