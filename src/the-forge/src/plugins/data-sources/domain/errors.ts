/** Failure codes the data-sources plugin registers in its error catalog; the host maps them to exit statuses. */
export type DataSourceErrorCode =
  | 'DATA_SOURCE_DRIFT'
  | 'INVALID_DATA_SOURCE'
  | 'DUPLICATE_DATA_SOURCE'
  | 'EMPTY_DATA_SOURCE_LIBRARY'
  | 'UNKNOWN_DATA_SOURCE'
  | 'DATA_SOURCE_RENDERER_UNAVAILABLE';

/** A plugin failure: an `Error` with a registered code that the plugin catalog normalizes. */
export function dataSourceError(code: DataSourceErrorCode, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

/** Throws the plugin failure `code` unless `condition` holds. */
export function ensureDataSource(condition: unknown, code: DataSourceErrorCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}

/** Whether `error` is the plugin failure `code`, before or after the host mapped it to its exit status. */
export const isDataSourceError = (error: unknown, code: DataSourceErrorCode): boolean => error instanceof Error && (error as { code?: unknown }).code === code;
