/** Failure codes the templates plugin registers in its error catalog; the host maps them to exit statuses. */
export type TemplateErrorCode =
  | 'INVALID_TEMPLATE'
  | 'INVALID_TEMPLATE_DATE'
  | 'INVALID_TEMPLATE_PACK'
  | 'INVALID_TEMPLATE_VALUES'
  | 'UNKNOWN_TEMPLATE_VARIABLE';

/** A plugin failure: an `Error` with a registered code that the plugin catalog normalizes. */
export function templateError(code: TemplateErrorCode, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

/** Throws the plugin failure `code` unless `condition` holds. */
export function ensureTemplate(condition: unknown, code: TemplateErrorCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}
