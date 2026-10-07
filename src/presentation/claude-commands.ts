import { ensure, isRecord } from '../domain/errors.ts';
import { claudeHookEvents } from '../domain/claude-hooks.ts';
import { claudePluginCapabilities } from '../domain/claude-plugins.ts';
import { ClaudeAgents } from '../application/claude-agents.ts';
import { ClaudeSettings } from '../application/claude-settings.ts';
import { ClaudePluginService } from '../application/claude-plugins.ts';
import type { Command, CommandContext } from '../application/plugins.ts';
import type { ClaudeServices } from './claude-services.ts';
import { arity, value } from './arguments.ts';
import { parseJson } from './input.ts';
import { claudeBytes, claudeInput, claudeInputOptions, claudeOptions, claudeScopeOptions } from './claude-input.ts';
import { buildClaudeRuntimeArgs, claudeRuntimeNeedsInput, claudeRuntimeOptions, claudeRuntimeOutput } from './claude-runtime-commands.ts';

type Flags = Record<string, string | boolean>;
const nativePluginActions = ['create', 'inspect', 'manifest', 'check', 'asset', 'write-asset', 'remove-asset'];
const sourceOptions = [...claudeInputOptions, 'metadata', 'prompt'];

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
      if (section === 'agents' || section === 'hooks') return nativeDefinitions(section, args.slice(1), flags, context, services);
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

async function nativeDefinitions(section: 'agents' | 'hooks', args: string[], flags: Flags, context: CommandContext, services: ClaudeServices) {
  const action = args[0] ?? (section === 'agents' ? 'list' : 'inspect');
  const mutating = ['create', 'update', 'set', 'add', 'remove', 'configure', 'enable', 'disable'].includes(action);
  const inputs = section === 'agents' && ['create', 'update'].includes(action) ? sourceOptions : section === 'hooks' && ['set', 'add', 'configure'].includes(action) ? claudeInputOptions : [];
  claudeOptions(flags, [...claudeScopeOptions, ...inputs, ...(mutating && action !== 'create' ? ['if-match'] : []), ...(section === 'agents' && action === 'export' ? ['out', 'if-match'] : []), ...(section === 'hooks' && action === 'remove' ? ['index'] : [])]);
  const target = await services.target(context, flags);
  const location = { scope: target.scope, directory: target.directory };
  const settings = new ClaudeSettings(target.workspace, target.settingsPath, target.scope === 'plugin');
  if (section === 'hooks') {
    const revision = value(flags, 'if-match');
    let result: unknown;
    if (action === 'inspect' || action === 'check') { arity(args, 0, 1); result = action === 'inspect' ? await settings.inspect() : await settings.validate(); }
    else if (action === 'set') { arity(args, 1); result = await settings.set(parseJson(await claudeInput(flags, context)), revision); }
    else if (action === 'add') { arity(args, 2); result = await settings.add(args[1]!, parseJson(await claudeInput(flags, context)), revision); }
    else if (action === 'configure') { arity(args, 1); result = await settings.configure(parseJson(await claudeInput(flags, context)), revision); }
    else if (action === 'remove') { arity(args, 2); const index = value(flags, 'index'); result = await settings.remove(args[1]!, value(flags, 'if-match', true)!, index === undefined ? undefined : Number(index)); }
    else { ensure(action === 'enable' || action === 'disable', 'INVALID_ARGUMENT', 'Use hooks inspect, check, set, add, remove, configure, enable, or disable.'); arity(args, 1); result = await settings.toggle(action === 'enable', revision); }
    return { target: location, ...result as object };
  }
  ensure(target.scope !== 'local', 'INVALID_ARGUMENT', 'Claude agents have project, user, or plugin scope; local applies only to settings.');
  const agents = new ClaudeAgents(target.workspace, services.agentCodec, target.agentsDirectory);
  let result: unknown;
  if (action === 'list') { arity(args, 0, 1); result = await agents.list(); }
  else {
    arity(args, 2); const id = args[1]!;
    if (action === 'inspect' || action === 'export') {
      const agent = await agents.inspect(id);
      result = action === 'inspect' ? agent : { ...agent, content: services.agentCodec.render({ metadata: agent.metadata, prompt: agent.prompt }), session: { [String(agent.metadata.name)]: { ...agent.metadata, prompt: agent.prompt } } };
      if (action === 'export') {
        const out = value(flags, 'out');
        ensure(out !== undefined || flags['if-match'] === undefined, 'INVALID_ARGUMENT', '--if-match requires --out for agent export.');
        if (out !== undefined) {
          ensure(out.endsWith('.md'), 'INVALID_ARGUMENT', 'Agent exports use a .md destination.');
          const content = services.agentCodec.render({ metadata: agent.metadata, prompt: agent.prompt });
          result = { ...result as object, outputRoot: context.root, ...await context.workspace.write([{ path: out, bytes: new TextEncoder().encode(content), expectedRevision: value(flags, 'if-match') }]), ...(context.workspace.dryRun ? { preview: [{ path: out, content }] } : {}) };
        }
      }
    } else if (action === 'create' || action === 'update') {
      const metadata = value(flags, 'metadata');
      let source: string;
      if (metadata !== undefined) {
        ensure(claudeInputOptions.every(key => flags[key] === undefined), 'INVALID_INPUT', '--metadata/--prompt cannot be combined with file or text input.');
        source = services.agentCodec.render({ metadata: parseJson(metadata) as Record<string, unknown>, prompt: value(flags, 'prompt', true)! });
      } else { ensure(flags.prompt === undefined, 'INVALID_INPUT', '--prompt requires --metadata.'); source = await claudeInput(flags, context); }
      result = action === 'create' ? await agents.create(id, source) : await agents.update(id, source, value(flags, 'if-match', true)!);
    } else if (action === 'remove') result = await agents.remove(id, value(flags, 'if-match', true)!);
    else { ensure(action === 'enable' || action === 'disable', 'INVALID_ARGUMENT', 'Use agents list, inspect, create, update, remove, enable, disable, or export.'); const agent = await agents.inspect(id); result = await settings.agentEnabled(String(agent.metadata.name), action === 'enable', value(flags, 'if-match')); }
  }
  return { target: location, ...result as object, ...(target.scope === 'plugin' ? { limitations: 'Claude Code ignores hooks, mcpServers, permissionMode and initialPrompt in plugin agents.' } : {}) };
}

async function nativePlugin(args: string[], flags: Flags, context: CommandContext, services: ClaudeServices) {
  const [action, directory, path] = args;
  claudeOptions(flags, [...(['create', 'manifest', 'write-asset'].includes(action!) ? claudeInputOptions : []), ...(['manifest', 'write-asset', 'remove-asset'].includes(action!) ? ['if-match'] : [])]);
  arity(args, ['asset', 'write-asset', 'remove-asset'].includes(action!) ? 3 : 2);
  const plugins = new ClaudePluginService(context.workspace, services.agentCodec);
  if (action === 'create') return plugins.create(directory!, parseJson(await claudeInput(flags, context)));
  if (action === 'manifest') return plugins.update(directory!, parseJson(await claudeInput(flags, context)), value(flags, 'if-match', true)!);
  if (action === 'inspect') return plugins.inspect(directory!);
  if (action === 'check') return plugins.validate(directory!);
  if (action === 'asset') return plugins.asset(directory!, path!);
  if (action === 'remove-asset') return plugins.removeAsset(directory!, path!, value(flags, 'if-match', true)!);
  return plugins.writeAsset(directory!, path!, await claudeBytes(flags, context), value(flags, 'if-match'));
}
