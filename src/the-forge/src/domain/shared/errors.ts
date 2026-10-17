import { errorCatalog, type ErrorCode } from './error-catalog.ts';

/**
 * Carries a stable code. Built-in failures use `forgeError` or `ensure`; other codes are plugin-defined. `retryable`
 * overrides the catalog's retryability when this occurrence knows better (a lock whose holder cannot be verified).
 */
export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly exitCode = 1, public readonly details?: Record<string, unknown>, public readonly retryable?: boolean) {
    super(message);
  }
}
/**
 * Create a built-in failure whose exit status comes from the error catalog. Only signal interruptions override it;
 * `retryable` overrides the catalog's retryability for this occurrence.
 */
export function forgeError(code: ErrorCode, message: string, details?: Record<string, unknown>, exitCode: number = errorCatalog[code].exitCode, retryable?: boolean): AppError {
  return new AppError(code, message, exitCode, details, retryable);
}
/** A failure with a plugin-registered code; its exit status comes from the plugin's error catalog entry. */
export function codedError(code: string, message: string, exitCode: number, details?: Record<string, unknown>): AppError {
  return new AppError(code, message, exitCode, details);
}
/** The same failure located inside a larger request: its message gains `prefix` and its details gain `details`. */
export function locatedError(error: AppError, prefix: string, details: Record<string, unknown>): AppError {
  return new AppError(error.code, `${prefix}${error.message}`, error.exitCode, { ...error.details, ...details }, error.retryable);
}
/** The same failure restated for another frame of reference, such as paths relative to a narrower scope. */
export function restatedError(error: AppError, message: string, details: Record<string, unknown> | undefined): AppError {
  return new AppError(error.code, message, error.exitCode, details, error.retryable);
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
