import { categoryExitCodes, type ErrorCategory } from '../../../domain/shared/error-catalog.ts';
import { AppError, summarizeError } from '../../../domain/shared/errors.ts';
import { PluginFailure } from '../../../domain/shared/plugin-failure.ts';

/** Failure codes the claude plugin registers in its error catalog; the host maps them to exit statuses. */
export type ClaudeErrorCode =
  | 'INVALID_CLAUDE_PLUGIN'
  | 'INVALID_CLAUDE_COMMAND'
  | 'INVALID_CLAUDE_ARGUMENT'
  | 'INVALID_CLAUDE_OPTION'
  | 'INVALID_CLAUDE_SCOPE'
  | 'INVALID_CLAUDE_INPUT'
  | 'INVALID_CLAUDE_OUTPUT'
  | 'INVALID_CLAUDE_OUTPUT_LIMIT'
  | 'INVALID_CLAUDE_TIMEOUT'
  | 'INVALID_CLAUDE_EXECUTABLE'
  | 'CLAUDE_NOT_INSTALLED'
  | 'CLAUDE_WORKING_DIRECTORY_UNAVAILABLE'
  | 'CLAUDE_COMMAND_FAILED'
  | 'CLAUDE_COMMAND_TIMEOUT'
  | 'CLAUDE_OUTPUT_LIMIT'
  | 'CLAUDE_COMMAND_INTERRUPTED'
  | 'CLAUDE_RUNTIME_FAILED'
  | 'CLAUDE_INVALID_OUTPUT';

/** The category of each code, which fixes its exit status. */
export const claudeErrorCategories: Readonly<Record<ClaudeErrorCode, ErrorCategory>> = {
  INVALID_CLAUDE_PLUGIN: 'input',
  INVALID_CLAUDE_COMMAND: 'input',
  INVALID_CLAUDE_ARGUMENT: 'input',
  INVALID_CLAUDE_OPTION: 'input',
  INVALID_CLAUDE_SCOPE: 'input',
  INVALID_CLAUDE_INPUT: 'input',
  INVALID_CLAUDE_OUTPUT: 'input',
  INVALID_CLAUDE_OUTPUT_LIMIT: 'input',
  INVALID_CLAUDE_TIMEOUT: 'input',
  INVALID_CLAUDE_EXECUTABLE: 'input',
  CLAUDE_NOT_INSTALLED: 'external',
  CLAUDE_WORKING_DIRECTORY_UNAVAILABLE: 'external',
  CLAUDE_COMMAND_FAILED: 'external',
  CLAUDE_COMMAND_TIMEOUT: 'external',
  CLAUDE_OUTPUT_LIMIT: 'external',
  CLAUDE_COMMAND_INTERRUPTED: 'interrupted',
  CLAUDE_RUNTIME_FAILED: 'external',
  CLAUDE_INVALID_OUTPUT: 'external',
};

/** A plugin failure: an `Error` with a registered code that the plugin catalog normalizes. */
export function claudeError(code: ClaudeErrorCode, message: string, details?: Record<string, unknown>): PluginFailure {
  return new PluginFailure(code, message, details);
}

/** Throws the plugin failure `code` unless `condition` holds. */
export function ensureClaude(condition: unknown, code: ClaudeErrorCode, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw new PluginFailure(code, message, details);
}


/**
 * `{code, exitCode}` of a failure for event payloads: this plugin's own failures by their category's exit status (a
 * SIGTERM interruption keeps 143) before the host maps them, and anything else as `summarizeError` reports it.
 */
export function summarizeClaudeError(error: unknown): { code: string; exitCode: number } {
  const code = error instanceof Error && !(error instanceof AppError) ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== 'string' || !Object.hasOwn(claudeErrorCategories, code)) return summarizeError(error);
  const exitCode = (error as { exitCode?: unknown }).exitCode;
  return { code, exitCode: typeof exitCode === 'number' ? exitCode : categoryExitCodes[claudeErrorCategories[code as ClaudeErrorCode]] };
}
