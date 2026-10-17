import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { ClaudeLifecycle } from './application/lifecycle.ts';
import type { ClaudeLifecycleClient } from '../../application/plugins/claude-lifecycle.ts';
import { claudeEvents } from './application/events.ts';
import { claudeAgentCodec } from './infrastructure/agents.ts';
import { claudeTarget } from './infrastructure/target.ts';
import { NodeClaudeRuntime } from './infrastructure/runtime.ts';
import { claudeCommand } from './presentation/commands.ts';
import { claudeStrings, de } from './presentation/strings.ts';
import { claudeText } from './presentation/messages.ts';

/** The service id of the Claude lifecycle client that trusted plugins require. */
const claudeLifecycleService = 'claude.lifecycle';

/**
 * The `claude` core plugin: the `claude` command family for native Claude Code agents, hooks and plugin assets, the
 * installed CLI lifecycle (plugins, marketplaces, runtime), and its `claude.*` lifecycle records. It provides
 * `claude.lifecycle`, a `ClaudeLifecycleClient` bound on activation to the invocation's root and dry-run setting;
 * plugins that run Claude Code declare `requires: ['claude.lifecycle']`.
 */
export const claudePlugin: CorePlugin = {
  manifest: {
    id: 'claude', name: 'Claude Code', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Manage native Claude Code agents, hooks and plugins, and run the installed Claude Code CLI lifecycle.',
  },
  strings: claudeStrings,
  create: host => {
    let lifecycle: ClaudeLifecycle | undefined;
    const client: ClaudeLifecycleClient = {
      execute: request => {
        ensure(lifecycle, 'PLUGIN_LIFECYCLE', 'The claude.lifecycle service runs Claude only while the claude plugin is active in a command invocation.');
        return lifecycle.execute(request);
      },
    };
    return {
      commands: [claudeCommand({ agentCodec: claudeAgentCodec, target: claudeTarget(host.openFiles), lifecycle: client })],
      events: [...claudeEvents],
      provides: { [claudeLifecycleService]: client },
      onload(context) {
        lifecycle = new ClaudeLifecycle(executable => new NodeClaudeRuntime({ executable }), { cwd: context.root, dryRun: context.workspace.dryRun }, context.events, () => host.operationId(), claudeText(context.language));
      },
      onunload() { lifecycle = undefined; },
      strings: { de },
    };
  },
};
