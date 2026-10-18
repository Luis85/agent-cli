import { agentCommands } from './agents.ts';
import { hookCommands } from './hooks.ts';
import { nativePlugin, nativePluginActions } from './plugin-assets.ts';
import { ensure, isRecord } from '../../../domain/shared/errors.ts';
import { claudeHookEvents } from '../../../domain/claude/hooks.ts';
import { claudePluginCapabilities } from '../domain/plugins.ts';
import type { Command } from '../../../application/plugins/registry.ts';
import type { ClaudeCommandServices, ClaudeServices } from './services.ts';
import { parseJson, value } from '../../../application/plugins/command-input.ts';
import { claudeInput } from './input.ts';
import { buildClaudeRuntimeArgs, claudeRuntimeNeedsInput, claudeRuntimeOutput } from './runtime-commands.ts';
import { claudeActions } from './actions.ts';
import { claudeMessages } from '../domain/messages.ts';
import { withLocalizedResults } from './messages.ts';
import { ensureClaude } from '../domain/errors.ts';

export function claudeCommand(adapters: ClaudeCommandServices): Command {
  return withLocalizedResults({
    id: 'claude', description: 'Manage native Claude Code agents, hooks and plugins with guarded writes and installed CLI lifecycle.',
    usage: 'claude capabilities | agents list|inspect|create|update|remove|enable|disable|export [id] | hooks inspect|check|set|add|remove|configure|enable|disable [event] | plugins create|inspect|manifest|check|asset|write-asset|remove-asset <directory> [path] | plugins list|details|install|update|uninstall|enable|disable|validate|configure|prune|init|tag|test|eval [id] | marketplaces add|list|remove|update [source] | runtime version|doctor|install|update',
    scope: 'project', discovery: false, mutating: true, defaultAction: 'capabilities',
    actions: claudeActions, unknownAction: 'INVALID_ARGUMENT',
    errors: [
      'INVALID_CLAUDE_AGENT', 'INVALID_CLAUDE_HOOKS', 'INVALID_CLAUDE_PLUGIN', 'INVALID_CLAUDE_SETTINGS', 'INVALID_CLAUDE_COMMAND', 'INVALID_CLAUDE_ARGUMENT',
      'INVALID_CLAUDE_OPTION', 'INVALID_CLAUDE_SCOPE', 'INVALID_CLAUDE_INPUT', 'INVALID_CLAUDE_EXECUTABLE', 'CLAUDE_NOT_INSTALLED', 'CLAUDE_WORKING_DIRECTORY_UNAVAILABLE',
      'CLAUDE_COMMAND_FAILED', 'CLAUDE_COMMAND_TIMEOUT', 'CLAUDE_COMMAND_INTERRUPTED', 'CLAUDE_OUTPUT_LIMIT', 'CLAUDE_RUNTIME_FAILED', 'CLAUDE_INVALID_OUTPUT',
      'INVALID_INPUT', 'INVALID_ENCODING', 'NOT_FOUND', 'CONFLICT',
    ],
    async run(args, flags, context) {
      const [section, action] = args;
      if (!section || section === 'capabilities') {
        return { provider: 'Claude Code', nativeFormats: true, documentation: 'https://code.claude.com/docs/en/sub-agents',
          agents: { scopes: ['project', 'user', 'plugin'], format: claudeMessages.agentFormat, operations: ['list', 'inspect', 'create', 'update', 'remove', 'enable', 'disable', 'export'], pluginIgnoredFields: ['hooks', 'mcpServers', 'permissionMode', 'initialPrompt'] },
          hooks: { scopes: ['project', 'local', 'user', 'plugin'], events: claudeHookEvents, operations: ['inspect', 'check', 'set', 'add', 'remove', 'configure', 'enable', 'disable'], execution: claudeMessages.hookExecution },
          plugins: claudePluginCapabilities,
          lifecycle: { executable: 'claude', commands: ['plugins list|details|install|update|uninstall|enable|disable|validate|configure|prune|init|tag|test|eval', 'marketplaces add|list|remove|update', 'runtime version|doctor|install|update'], mutationDefaultScope: claudeMessages.mutationScope, dryRun: claudeMessages.lifecycleDryRun } };
      }
      const services: ClaudeServices = { agentCodec: adapters.agentCodec(context.workspace.codec), target: adapters.target };
      if (section === 'agents') return agentCommands(args.slice(1), flags, context, services);
      if (section === 'hooks') return hookCommands(args.slice(1), flags, context, services);
      if (section === 'plugins' && nativePluginActions.includes(action ?? '')) return nativePlugin(args.slice(1), flags, context, services);
      ensure(section === 'plugins' || section === 'marketplaces' || section === 'runtime', 'INVALID_ARGUMENT', 'Use claude agents, hooks, plugins, marketplaces, runtime, or capabilities.');
      const command = buildClaudeRuntimeArgs(section, args.slice(1), flags);
      const timeout = value(flags, 'timeout');
      const timeoutMs = timeout === undefined ? undefined : Number(timeout);
      ensure(timeoutMs === undefined || (Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 3600000), 'INVALID_ARGUMENT', '--timeout must be milliseconds from 1 to 3600000.');
      const executable = value(flags, 'claude-bin');
      let input: string | undefined;
      if (claudeRuntimeNeedsInput(section, args.slice(1), flags)) {
        const values = parseJson(await claudeInput(flags, context));
        ensure(isRecord(values) && Object.values(values).every(item => typeof item === 'string' && !/[\r\n]/.test(item)), 'INVALID_INPUT', 'Claude plugin configuration must map keys to single-line string values.');
        input = JSON.stringify(values) + '\n';
        ensureClaude(new TextEncoder().encode(input).length <= 1024 * 1024, 'INVALID_CLAUDE_INPUT', 'Claude configuration input must not exceed 1 MiB.');
      }
      return adapters.lifecycle.execute({ args: command, executable, timeoutMs, stdin: input, output: claudeRuntimeOutput(section, args.slice(1), flags) });
    },
  });
}
