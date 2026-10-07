import { AppError } from '../domain/errors.ts';

export function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { throw new AppError('INVALID_JSON', 'Expected valid JSON input.', 2); }
}
