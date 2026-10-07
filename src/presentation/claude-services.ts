import type { CommandContext } from '../application/plugins.ts';
import type { ClaudeAgentCodec } from '../application/claude-agents.ts';
import type { ClaudeTarget } from '../application/claude-target.ts';
export interface ClaudeServices {
  agentCodec: ClaudeAgentCodec;
  target(context: CommandContext, flags: Record<string, string | boolean>): Promise<ClaudeTarget>;
}
