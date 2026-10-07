export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly exitCode = 1, public readonly details?: Record<string, unknown>) {
    super(message);
  }
}
/** Event diagnostics deliberately omit messages, input and arbitrary error details. */
export function summarizeError(error: unknown): { code: string; exitCode: number } {
  return error instanceof AppError ? { code: error.code, exitCode: error.exitCode } : { code: 'OPERATION_FAILED', exitCode: 1 };
}
export function errorMessage(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error); }
  catch { return 'Operation failed with an unreadable error.'; }
}
export function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new AppError(code, message, 2);
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
