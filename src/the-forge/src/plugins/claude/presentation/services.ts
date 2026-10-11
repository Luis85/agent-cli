import type { CommandContext } from '../../../application/plugins/registry.ts';
import type { DocumentCodec } from '../../../application/workspace/ports.ts';
import type { ClaudeAgentCodec } from '../application/agents.ts';
import type { ClaudeTarget } from '../application/target.ts';
import type { ClaudeLifecycleClient } from '../../../application/plugins/claude-lifecycle.ts';

/** What the `claude` command's handlers use within one invocation. */
export interface ClaudeServices {
  agentCodec: ClaudeAgentCodec;
  target(context: CommandContext, flags: Record<string, string | boolean>): Promise<ClaudeTarget>;
}

/** The `claude` command's adapters: the agent codec over the invocation's document codec, targets and the lifecycle client. */
export interface ClaudeCommandServices {
  agentCodec(documents: DocumentCodec): ClaudeAgentCodec;
  target: ClaudeServices['target'];
  lifecycle: ClaudeLifecycleClient;
}
