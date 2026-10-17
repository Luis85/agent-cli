import { AppError } from './errors.ts';

/**
 * A plugin's failure: an `Error` with a code its plugin registers in its error catalog, and optional `details`.
 * Plugins never construct host errors or pick exit statuses; the host's `PluginCatalog.normalize` turns the code
 * into a coded failure with its category's exit status when it leaves the plugin's command, generator or `onload`.
 */
export class PluginFailure extends Error {
  declare readonly details?: Record<string, unknown>;
  constructor(public readonly code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    if (details) this.details = details;
  }
}

/** Whether `error` already carries a code, as a host error or a plugin failure, so a wrapper passes it on unchanged. */
export function isCodedFailure(error: unknown): error is AppError | PluginFailure {
  return error instanceof AppError || error instanceof PluginFailure;
}
