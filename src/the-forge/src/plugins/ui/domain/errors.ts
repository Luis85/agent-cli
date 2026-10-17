/** Failure codes the ui plugin registers in its error catalog; the host maps them to exit statuses. */
export type UiErrorCode =
  | 'UI_DRIFT'
  | 'INVALID_UI'
  | 'INVALID_UI_LIBRARY'
  | 'INVALID_UI_FRAMEWORK'
  | 'EMPTY_UI_LIBRARY'
  | 'DUPLICATE_UI_COMPONENT'
  | 'UNKNOWN_UI_COMPONENT'
  | 'CYCLIC_UI_COMPONENT'
  | 'UI_RENDERER_UNAVAILABLE'
  | 'INVALID_INTERACTION'
  | 'DUPLICATE_INTERACTION'
  | 'EMPTY_INTERACTION_LIBRARY'
  | 'UNKNOWN_INTERACTION';

/** A plugin failure: an `Error` with a registered code that the plugin catalog normalizes. */
export function uiError(code: UiErrorCode, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

/** Throws the plugin failure `code` unless `condition` holds. */
export function ensureUi(condition: unknown, code: UiErrorCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

/** Whether `error` is the plugin failure `code`, before or after the host mapped it to its exit status. */
export const isUiError = (error: unknown, code: UiErrorCode): boolean => error instanceof Error && (error as { code?: unknown }).code === code;
