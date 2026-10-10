import { diagnostic, isObject, pointer, record, stringList, type AgentConfigDocument, type AgentDiagnostic } from './config.ts';
import { claudeToolsFor, filesystemTools, readOnlyFilesystemTools, taskTools, writeTools } from './claude-vocabulary.ts';
import { mcpServer, type McpServer } from './claude-mcp.ts';

/** A Claude tool: a built-in tool name, or one tool (`*` for all) of an MCP server whose generated name is final later. */
export type ToolGrant = string | { server: McpServer; tool: string };
/** The `tools` entry of a grant. */
export const toolName = (grant: ToolGrant) => typeof grant === 'string' ? grant : `mcp__${grant.server.name}__${grant.tool}`;

/** What an agent's toolsets grant in Claude Code. `permissions` become project settings rules with `--settings`. */
export interface ClaudeTools {
  tools: ToolGrant[]; disallowedTools: string[]; memory: boolean; servers: McpServer[];
  permissions: { allow: string[]; deny: string[] };
  diagnostics: AgentDiagnostic[];
}
interface ResolvedToolset { toolset: Record<string, unknown>; at: string }

/** Inline toolsets first, then `use_toolsets` in order, like docker-agent; MCP definition refs merge their definition. */
function resolvedToolsets(config: AgentConfigDocument, name: string, agent: Record<string, unknown>): ResolvedToolset[] {
  const inline = (Array.isArray(agent.toolsets) ? agent.toolsets : []).map((toolset, index) => ({ toolset: record(toolset), at: pointer('agents', name, 'toolsets', index) }));
  const shared = stringList(agent.use_toolsets).map(ref => ({ toolset: record(record(config.toolsets)[ref]), at: pointer('toolsets', ref) }));
  return [...inline, ...shared].map(({ toolset, at }) => {
    const ref = toolset.ref;
    if (toolset.type !== 'mcp' || typeof ref !== 'string' || ref.startsWith('docker:') || !isObject(record(config.mcps)[ref])) return { toolset, at };
    const definition = record(record(config.mcps)[ref]);
    const merged: Record<string, unknown> = { ...definition, name: ref, ...Object.fromEntries(Object.entries(toolset).filter(([key, value]) => key !== 'ref' && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0))) };
    if (isObject(definition.env) || isObject(toolset.env)) merged.env = { ...record(definition.env), ...record(toolset.env) };
    if (typeof definition.ref === 'string') merged.ref = definition.ref; else delete merged.ref;
    return { toolset: merged, at };
  });
}

/** Path rules for a filesystem allow or deny list entry. */
function pathRules(entry: string): string[] {
  const root = entry.startsWith('/') ? `/${entry}` : entry.startsWith('~') ? entry : `./${entry.replace(/^\.\/?/, '')}`;
  const glob = `${root.replace(/\/+$/, '')}/**`;
  return [`Read(${glob})`, `Edit(${glob})`];
}

const ignoredFields: Readonly<Record<string, string>> = {
  instruction: 'toolset instructions', defer: 'deferred loading', timeout: 'tool timeouts', toon: 'TOON output', env: 'toolset environment variables',
  post_edit: 'post-edit commands', ignore_vcs: 'VCS ignore handling', sudo_askpass: 'sudo prompts', escape_html: 'HTML escaping', headers: 'request headers',
};

/** Built-in tools of one toolset narrowed by its `tools` allow filter. */
function filtered(granted: readonly string[], toolset: Record<string, unknown>, at: string, diagnostics: AgentDiagnostic[]): string[] {
  const filter = stringList(toolset.tools);
  if (filter.length === 0) return [...granted];
  const allowed = new Set(filter.flatMap(claudeToolsFor));
  diagnostics.push(diagnostic('warning', 'tool-filter', `${at}/tools`, `The tools filter ${filter.join(', ')} is approximated by the Claude tools ${granted.filter(tool => allowed.has(tool)).join(', ') || '(none)'}.`, 'A'));
  return granted.filter(tool => allowed.has(tool));
}

/**
 * Maps an agent's toolsets to Claude tools: filesystem, shell, fetch, todo and tasks, memory, user_prompt and MCP
 * servers have equivalents; think is covered by `effort`; every other toolset type is not emitted.
 */
export function claudeTools(config: AgentConfigDocument, name: string, agent: Record<string, unknown>): ClaudeTools {
  const result: ClaudeTools = { tools: [], disallowedTools: [], memory: false, servers: [], permissions: { allow: [], deny: [] }, diagnostics: [] };
  const warn = (code: string, at: string, message: string, fidelity: 'A' | 'U' = 'A') => result.diagnostics.push(diagnostic(fidelity === 'A' ? 'warning' : 'info', code, at, message, fidelity));
  const agentReadonly = agent.readonly === true;
  for (const { toolset, at } of resolvedToolsets(config, name, agent)) {
    const type = String(toolset.type), readonly = agentReadonly || toolset.readonly === true;
    for (const [field, label] of Object.entries(ignoredFields)) if (toolset[field] !== undefined && !(type === 'mcp' && (field === 'env' || field === 'headers'))) {
      warn('toolset-field-unsupported', `${at}/${field}`, `${label[0]!.toUpperCase()}${label.slice(1)} (${field}) have no Claude equivalent and are not emitted.`, 'U');
    }
    if (type === 'filesystem') {
      result.tools.push(...filtered(readonly ? readOnlyFilesystemTools : filesystemTools, toolset, at, result.diagnostics));
      warn('toolset-approximated', at, `The filesystem toolset is approximated by the Claude tools ${(readonly ? readOnlyFilesystemTools : filesystemTools).join(', ')}.`);
      for (const [field, list] of [['allow_list', result.permissions.allow], ['deny_list', result.permissions.deny]] as const) {
        const entries = stringList(toolset[field]);
        if (entries.length === 0) continue;
        list.push(...entries.flatMap(pathRules));
        warn('permission-approximated', `${at}/${field}`, `${field} becomes Read and Edit permission rules in project settings with --settings.`);
      }
    } else if (type === 'shell') {
      if (readonly) warn('readonly-approximated', at, 'A read-only shell toolset exposes no tools in docker-agent; Bash is not granted.');
      else result.tools.push(...filtered(['Bash'], toolset, at, result.diagnostics));
    } else if (type === 'fetch') {
      result.tools.push(...filtered(['WebFetch'], toolset, at, result.diagnostics));
      for (const [field, list] of [['allowed_domains', result.permissions.allow], ['blocked_domains', result.permissions.deny]] as const) {
        const domains = stringList(toolset[field]);
        if (domains.length === 0) continue;
        list.push(...domains.filter(domain => !domain.includes('/')).map(domain => `WebFetch(domain:${domain.replace(/^\*\./, '*.')})`));
        warn('permission-approximated', `${at}/${field}`, `${field} becomes WebFetch(domain:…) permission rules in project settings with --settings; CIDR ranges are not emitted.`);
      }
    } else if (type === 'todo' || type === 'tasks') {
      result.tools.push(...filtered(taskTools, toolset, at, result.diagnostics));
      warn('toolset-approximated', at, `The ${type} toolset is approximated by Claude's task tools ${taskTools.join(', ')}.`);
    } else if (type === 'memory') {
      result.memory = true;
      warn('toolset-approximated', at, 'The memory toolset is approximated by memory: project; its database path is not used.');
    } else if (type === 'user_prompt') {
      result.tools.push('AskUserQuestion');
      warn('toolset-approximated', at, 'The user_prompt toolset is approximated by AskUserQuestion.');
    } else if (type === 'think') {
      warn('toolset-approximated', at, 'The think toolset is not emitted; Claude models think natively, tuned by effort.');
    } else if (type === 'mcp') {
      const server = mcpServer(toolset, at, result.servers.map(entry => entry.name));
      result.diagnostics.push(...server.diagnostics);
      if (server.server) {
        result.servers.push(server.server);
        const tools = stringList(toolset.tools), mapped = server.server;
        result.tools.push(...(tools.length > 0 ? tools : ['*']).map(tool => ({ server: mapped, tool })));
        if (readonly) warn('readonly-approximated', at, `Claude cannot select read-only tools of MCP server ${server.server.name}; every granted tool is emitted.`);
      }
    } else {
      result.diagnostics.push(diagnostic('warning', 'toolset-unsupported', at, `The ${type} toolset has no Claude equivalent and is not emitted.`, 'U'));
    }
  }
  if (agentReadonly) {
    result.disallowedTools.push(...writeTools);
    warn('readonly-approximated', pointer('agents', name, 'readonly'), `readonly keeps read-only tools and disallows ${writeTools.join(', ')}.`);
  }
  result.tools = [...new Set(result.tools)];
  return result;
}

