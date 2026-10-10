/** Failure codes the agents plugin registers in its error catalog; the host maps them to exit statuses. */
export type AgentErrorCode = 'INVALID_AGENT_DEFINITION' | 'AGENT_NOT_FOUND' | 'AGENT_EXISTS' | 'AGENT_DRIFT' | 'AGENT_MERGE_CONFLICT';

/** A plugin failure: an `Error` with a registered code that the plugin catalog normalizes. */
export function agentError(code: AgentErrorCode, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) });
}
