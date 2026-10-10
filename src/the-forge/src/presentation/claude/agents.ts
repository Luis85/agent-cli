import { ensure } from '../../domain/shared/errors.ts';
import { ClaudeAgents } from '../../application/claude/agents.ts';
import { ClaudeSettings } from '../../application/claude/settings.ts';
import type { CommandContext } from '../../application/plugins/registry.ts';
import type { ClaudeServices } from './services.ts';
import { arity, value } from '../../application/plugins/command-input.ts';
import { parseJson } from '../cli/input.ts';
import { claudeInput, claudeInputOptions, claudeOptions, claudeScopeOptions } from './input.ts';

type Flags = Record<string, string | boolean>;
type AgentInspection = Awaited<ReturnType<ClaudeAgents['inspect']>>;

async function agentSource(flags: Flags, context: CommandContext, services: ClaudeServices): Promise<string> {
  const metadata = value(flags, 'metadata');
  if (metadata === undefined) {
    ensure(flags.prompt === undefined, 'INVALID_INPUT', '--prompt requires --metadata.');
    return claudeInput(flags, context);
  }
  ensure(claudeInputOptions.every(key => flags[key] === undefined), 'INVALID_INPUT', '--metadata/--prompt cannot be combined with file or text input.');
  return services.agentCodec.render({ metadata: parseJson(metadata) as Record<string, unknown>, prompt: value(flags, 'prompt', true)! });
}

async function exportAgent(agent: AgentInspection, flags: Flags, context: CommandContext, services: ClaudeServices) {
  const content = services.agentCodec.render({ metadata: agent.metadata, prompt: agent.prompt });
  const result = { ...agent, content, session: { [String(agent.metadata.name)]: { ...agent.metadata, prompt: agent.prompt } } };
  const out = value(flags, 'out');
  ensure(out !== undefined || flags['if-match'] === undefined, 'INVALID_ARGUMENT', '--if-match requires --out for agent export.');
  if (out === undefined) return result;
  ensure(out.endsWith('.md'), 'INVALID_ARGUMENT', 'Agent exports use a .md destination.');
  const written = await context.workspace.write([{ path: out, bytes: new TextEncoder().encode(content), expectedRevision: value(flags, 'if-match') }]);
  return { ...result, outputRoot: context.root, ...written, ...(context.workspace.dryRun ? { preview: [{ path: out, content }] } : {}) };
}

export async function agentCommands(args: string[], flags: Flags, context: CommandContext, services: ClaudeServices) {
  const action = args[0] ?? 'list';
  const mutating = ['update', 'remove', 'enable', 'disable'].includes(action);
  const inputs = ['create', 'update'].includes(action) ? [...claudeInputOptions, 'metadata', 'prompt'] : [];
  claudeOptions(flags, [...claudeScopeOptions, ...inputs, ...(mutating ? ['if-match'] : []), ...(action === 'export' ? ['out', 'if-match'] : [])]);
  const target = await services.target(context, flags);
  ensure(target.scope !== 'local', 'INVALID_ARGUMENT', 'Claude agents have project, user, or plugin scope; local applies only to settings.');
  const agents = new ClaudeAgents(target.workspace, services.agentCodec, target.agentsDirectory);
  const settings = new ClaudeSettings(target.workspace, target.settingsPath, target.scope === 'plugin');
  let result: object;
  if (action === 'list') {
    arity(args, 0, 1);
    result = await agents.list();
  } else {
    arity(args, 2);
    const id = args[1]!;
    switch (action) {
      case 'inspect': result = await agents.inspect(id); break;
      case 'export': result = await exportAgent(await agents.inspect(id), flags, context, services); break;
      case 'create': result = await agents.create(id, await agentSource(flags, context, services)); break;
      case 'update': result = await agents.update(id, await agentSource(flags, context, services), value(flags, 'if-match', true)!); break;
      case 'remove': result = await agents.remove(id, value(flags, 'if-match', true)!); break;
      default: {
        ensure(action === 'enable' || action === 'disable', 'INVALID_ARGUMENT', 'Use agents list, inspect, create, update, remove, enable, disable, or export.');
        const agent = await agents.inspect(id);
        result = await settings.agentEnabled(String(agent.metadata.name), action === 'enable', value(flags, 'if-match'));
      }
    }
  }
  return { target: { scope: target.scope, directory: target.directory }, ...result,
    ...(target.scope === 'plugin' ? { limitations: 'Claude Code ignores hooks, mcpServers, permissionMode and initialPrompt in plugin agents.' } : {}) };
}
