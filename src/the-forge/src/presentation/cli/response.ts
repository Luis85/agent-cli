import type { LocalizedError } from '../localization/localization.ts';

/** What one invocation reports: its result, the executed scope once resolved, selected events and warnings. */
export interface InvocationResponse {
  result: { ok: true; data: unknown } | { ok: false; error: LocalizedError };
  context?: unknown;
  events: readonly unknown[];
  warnings: readonly string[];
}

/**
 * The single JSON document of an invocation on stdout, compact or indented. A result that cannot be serialized
 * becomes the compact `invalidResult` failure, which keeps the context, committed change evidence and warnings.
 */
export function responseDocument(response: InvocationResponse, compact: boolean, invalidResult: () => LocalizedError): { text: string; serializable: boolean } {
  const { result, context, events, warnings } = response;
  const envelope = (outcome: InvocationResponse['result']) => ({ ...outcome, ...(context ? { context } : {}), events, warnings });
  try { return { text: JSON.stringify(envelope(result), null, compact ? undefined : 2) + '\n', serializable: true }; }
  catch { return { text: JSON.stringify(envelope({ ok: false, error: invalidResult() })) + '\n', serializable: false }; }
}
