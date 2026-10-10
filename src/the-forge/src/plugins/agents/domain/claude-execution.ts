import { diagnostic, pointer, type AgentDiagnostic } from './config.ts';
import { toolName } from './claude-tools.ts';
import type { ClaudeAgentDraft } from './claude-agent.ts';
import type { McpServer } from './claude-mcp.ts';

/** Where generated MCP servers go: nowhere (the default), inline in agent frontmatter, or the project's `.mcp.json`. */
export type McpMode = 'none' | 'inline' | 'project';

/**
 * Tools an agent without any Claude tool disallows besides `tools: []`, in case a Claude Code version reads an empty
 * list like an omitted one: every built-in tool that writes files, runs commands or reaches the network.
 */
export const noToolsDisallowed = ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch'] as const;

const serverTarget = (server: McpServer) => server.commandLine ?? String(server.config.url);

/** MCP servers by `--mcp`: skipped servers are reported, and every server that starts a process is listed. */
function servers(draft: ClaudeAgentDraft, mode: McpMode, diagnostics: AgentDiagnostic[]): McpServer[] {
  if (mode === 'none') {
    for (const server of draft.servers) {
      diagnostics.push(diagnostic('info', 'mcp-not-generated', server.at, `MCP server ${server.declared} (${serverTarget(server)}) is not generated and its tools are not granted; pass --mcp inline or --mcp project to write it.`, 'U'));
    }
    return [];
  }
  const target = mode === 'inline' ? `.claude/agents/${draft.name}.md` : '.mcp.json';
  for (const server of draft.servers) if (server.commandLine !== undefined) {
    diagnostics.push(diagnostic('warning', 'executes-command', server.at, `MCP server ${server.name} in ${target} runs the command: ${server.commandLine}`));
  }
  return draft.servers;
}

/** Hooks only with `--hooks`; each command they run is listed, and skipped ones are reported. */
function hooks(draft: ClaudeAgentDraft, enabled: boolean, diagnostics: AgentDiagnostic[]): Record<string, unknown[]> | undefined {
  if (!draft.hooks) return undefined;
  if (!enabled) {
    const skipped = draft.hookCommands.map(entry => `${entry.event}: ${entry.command}`).join('; ');
    diagnostics.push(diagnostic('info', 'hooks-not-generated', pointer('agents', draft.agent, 'hooks'), `Hooks run commands and are generated only with --hooks; skipped ${skipped}.`, 'U'));
    return undefined;
  }
  for (const entry of draft.hookCommands) {
    diagnostics.push(diagnostic('warning', 'executes-command', entry.at, `The ${entry.event} hook of ${draft.name} runs the command: ${entry.command}`));
  }
  return draft.hooks;
}

/**
 * Completes an agent's frontmatter with what can execute: MCP servers (`--mcp`), hooks (`--hooks`) and the tools list.
 * `tools` is always explicit: an agent whose toolsets map to no Claude tool gets `tools: []` instead of inheriting
 * every tool of the session, as a docker-agent agent without toolsets has no tools.
 */
export function completeAgent(draft: ClaudeAgentDraft, options: { mcp: McpMode; hooks: boolean }, diagnostics: AgentDiagnostic[]): Record<string, unknown> {
  const emitted = servers(draft, options.mcp, diagnostics), mapped = hooks(draft, options.hooks, diagnostics);
  const tools = [...new Set(draft.grants.filter(grant => typeof grant === 'string' || emitted.includes(grant.server)).map(toolName))];
  const disallowed = [...draft.disallowed];
  if (tools.length === 0) {
    disallowed.push(...noToolsDisallowed.filter(tool => !disallowed.includes(tool)));
    diagnostics.push(diagnostic('info', 'tools-none', pointer('agents', draft.agent), `No toolset grants a Claude tool, so ${draft.name} gets tools: [] and disallows ${noToolsDisallowed.join(', ')} instead of inheriting every tool.`, 'E'));
  }
  return {
    ...draft.metadata, tools: tools.length > 0 ? tools.join(', ') : [],
    ...(disallowed.length > 0 ? { disallowedTools: disallowed.join(', ') } : {}),
    ...(emitted.length > 0 ? { mcpServers: options.mcp === 'inline' ? emitted.map(server => ({ [server.name]: server.config })) : [...new Set(emitted.map(server => server.name))] } : {}),
    ...(mapped ? { hooks: mapped } : {}),
  };
}
