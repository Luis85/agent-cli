export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly exitCode = 1) {
    super(message);
  }
}
export function ensure(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new AppError(code, message, 2);
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
