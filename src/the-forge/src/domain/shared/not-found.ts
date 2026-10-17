import { AppError } from './errors.ts';

/** Whether `error` is the host's NOT_FOUND failure for a missing file or folder. */
export function isNotFound(error: unknown): boolean {
  return error instanceof AppError && error.code === 'NOT_FOUND';
}

/** The value `read` resolves to, or undefined when what it reads is missing (NOT_FOUND); other failures propagate. */
export async function readOrMissing<T>(read: () => Promise<T>): Promise<T | undefined> {
  try { return await read(); }
  catch (error) { if (isNotFound(error)) return undefined; throw error; }
}
