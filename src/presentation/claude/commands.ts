import { agentCommands } from './agents.ts';
import { hookCommands } from './hooks.ts';
import { nativePlugin, nativePluginActions } from './plugin-assets.ts';
import { ensure, isRecord } from '../../domain/shared/errors.ts';
import { claudeHookEvents } from '../../domain/claude/hooks.ts';
import { claudePluginCapabilities } from '../../domain/claude/plugins.ts';
import type { Command } from '../../application/plugins/registry.ts';
import type { ClaudeServices } from './services.ts';
import { arity, value } from '../cli/arguments.ts';
import { parseJson } from '../cli/input.ts';
import { claudeInput, claudeInputOptions, claudeOptions } from './input.ts';
import { buildClaudeRuntimeArgs, claudeRuntimeNeedsInput, claudeRuntimeOptions, claudeRuntimeOutput } from './runtime-commands.ts';


export function claudeCommand(services: ClaudeServices): Command {
  return {
    id: 'claude', description: 'Manage native Claude Code agents, hooks and plugins with guarded writes and installed CLI lifecycle.',
    usage: 'claude capabilities | agents list|inspect|create|update|remove|enable|disable|export [id] | hooks inspect|check|set|add|remove|configure|enable|disable [event] | plugins create|inspect|manifest|check|asset|write-asset|remove-asset <directory> [path] | plugins list|details|install|update|uninstall|enable|disable|validate|configure|prune|init|tag|test|eval [id] | marketplaces add|list|remove|update [source] | runtime version|doctor|install|update',
    options: { ...claudeRuntimeOptions, scope: 'string', directory: 'string', 'claude-dir': 'string', ...Object.fromEntries(claudeInputOptions.map(key => [key, key === 'stdin' ? 'boolean' : 'string'] as const)), metadata: 'string', prompt: 'string', 'if-match': 'string', out: 'string', index: 'string', 'claude-bin': 'string', timeout: 'string', available: 'boolean', strict: 'boolean' },
    async run(args, flags, context) {
      const [section, action] = args;
      if (!section || section === 'capabilities') {
        arity(args, 0, 1); claudeOptions(flags, []);
        return { provider: 'Claude Code', nativeFormats: true, documentation: 'https://code.claude.com/docs/en/sub-agents',
          agents: { scopes: ['project', 'user', 'plugin'], format: 'Markdown with YAML frontmatter', operations: ['list', 'inspect', 'create', 'update', 'remove', 'enable', 'disable', 'export'], pluginIgnoredFields: ['hooks', 'mcpServers', 'permissionMode', 'initialPrompt'] },
          hooks: { scopes: ['project', 'local', 'user', 'plugin'], events: claudeHookEvents, operations: ['inspect', 'check', 'set', 'add', 'remove', 'configure', 'enable', 'disable'], execution: 'Claude Code owns execution; Forge never runs hook handlers.' },
          plugins: claudePluginCapabilities,
          lifecycle: { executable: 'claude', commands: ['plugins list|details|install|update|uninstall|enable|disable|validate|configure|prune|init|tag|test|eval', 'marketplaces add|list|remove|update', 'runtime version|doctor|install|update'], mutationDefaultScope: 'project where the native command supports a scope', dryRun: 'Returns command arguments without starting Claude Code.' } };
      }
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
        ensure(new TextEncoder().encode(input).length <= 1024 * 1024, 'INVALID_CLAUDE_INPUT', 'Claude configuration input must not exceed 1 MiB.');
      }
      return context.claude.execute({ args: command, executable, timeoutMs, stdin: input, output: claudeRuntimeOutput(section, args.slice(1), flags) });
    },
  };
}
