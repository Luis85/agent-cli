/** Failure codes the bases plugin registers in its error catalog; the host maps them to exit statuses. */
export type BasesErrorCode =
  | 'INVALID_BASE_QUERY'
  | 'INVALID_BASE_EXPRESSION'
  | 'BASE_EVALUATION_ERROR'
  | 'BASE_TIMEOUT'
  | 'BASE_VIEW_NOT_FOUND'
  | 'BASE_CONTEXT_NOT_FOUND'
  | 'INVALID_BASE_PROPERTY_TYPES'
  | 'UNSUPPORTED_BASE_PROPERTY_TYPE';

/** A plugin failure: an `Error` with a registered code that the plugin catalog normalizes. */
export function basesError(code: BasesErrorCode, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

/** Throws the plugin failure `code` unless `condition` holds. */
export function ensureBases(condition: unknown, code: BasesErrorCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}
