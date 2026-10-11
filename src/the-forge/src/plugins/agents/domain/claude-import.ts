import { diagnostic, isObject, pointer, record, stringList, text, type AgentDiagnostic } from './config.ts';
import { aliasModels, hookEvents, modelAlias } from './claude-vocabulary.ts';
import { say } from './messages.ts';

/** A docker-agent agent converted from a Claude agent, with a diagnostic for everything approximated or dropped. */
export interface ImportedAgent { name: string; agent: Record<string, unknown>; diagnostics: AgentDiagnostic[] }

const fileTools = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const writing = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const taskTools = ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskOutput', 'TaskStop', 'TodoWrite'];
const unsupportedFields = ['permissionMode', 'background', 'isolation', 'color', 'initialPrompt', 'omitClaudeMd', 'experimental', 'effort'];
const known = ['name', 'description', 'model', 'tools', 'disallowedTools', 'mcpServers', 'maxTurns', 'skills', 'memory', 'hooks', 'x-forge-source', ...unsupportedFields];
/** Claude Code tool name → docker-agent built-in tool name, for hook matchers. */
const reverseTools: Readonly<Record<string, string>> = { Read: 'read_file', Write: 'write_file', Edit: 'edit_file', Glob: 'list_directory', Grep: 'search_files_content', Bash: 'shell', WebFetch: 'fetch', AskUserQuestion: 'user_prompt' };
const reverseEvents = Object.fromEntries(Object.entries(hookEvents).filter(([event]) => !['before_compaction', 'after_compaction'].includes(event)).map(([event, claude]) => [claude, event]));

const toolList = (value: unknown) => (typeof value === 'string' ? value.split(',') : stringList(value)).map(tool => tool.trim()).filter(tool => tool !== '');

function model(value: unknown, defaultModel: string, diagnostics: AgentDiagnostic[]): string {
  if (typeof value === 'string' && /^claude-[a-z0-9.-]+$/.test(value)) return `anthropic/${value}`;
  const alias = typeof value === 'string' ? modelAlias(value) : undefined;
  if (alias && value === alias) {
    diagnostics.push(diagnostic('warning', 'model-approximated', '/model', say('importAlias', { alias, model: aliasModels[alias]! }), 'A'));
    return `anthropic/${aliasModels[alias]}`;
  }
  diagnostics.push(diagnostic('warning', 'model-approximated', '/model', value === undefined ? say('importOmittedModel', { default: defaultModel }) : say('importModel', { model: String(value), default: defaultModel }), 'A'));
  return defaultModel;
}

function mcpToolsets(metadata: Record<string, unknown>, grants: Map<string, string[]>, diagnostics: AgentDiagnostic[]): Record<string, unknown>[] {
  return (Array.isArray(metadata.mcpServers) ? metadata.mcpServers as unknown[] : []).flatMap((entry, index): Record<string, unknown>[] => {
    const at = pointer('mcpServers', index);
    if (typeof entry === 'string') {
      diagnostics.push(diagnostic('warning', 'mcp-reference-unsupported', at, say('serverReference', { server: entry }), 'U'));
      return [];
    }
    return Object.entries(record(entry)).flatMap(([name, value]): Record<string, unknown>[] => {
      const server = record(value), type = server.type ?? 'stdio', tools = grants.get(name)?.filter(tool => tool !== '*') ?? [];
      const filter = tools.length > 0 ? { tools } : {};
      if (type === 'stdio') return [{ type: 'mcp', name, command: server.command, ...(stringList(server.args).length > 0 ? { args: stringList(server.args) } : {}), ...(isObject(server.env) ? { env: server.env } : {}), ...filter }];
      if (type === 'http' || type === 'sse') {
        const remote = { url: server.url, transport_type: type === 'sse' ? 'sse' : 'streamable', ...(isObject(server.headers) ? { headers: server.headers } : {}) };
        return [{ type: 'mcp', name, remote, ...filter }];
      }
      diagnostics.push(diagnostic('warning', 'mcp-transport-unsupported', `${at}${pointer(name)}`, say('transportUnsupported', { type: String(type) }), 'U'));
      return [];
    });
  });
}

function toolsets(metadata: Record<string, unknown>, diagnostics: AgentDiagnostic[]): { toolsets: Record<string, unknown>[]; subAgents: string[] } {
  const granted = metadata.tools === undefined ? undefined : toolList(metadata.tools);
  const disallowed = toolList(metadata.disallowedTools);
  const tools = granted ?? ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'TaskCreate', 'AskUserQuestion'];
  if (granted === undefined) diagnostics.push(diagnostic('warning', 'tools-inherited', '/tools', say('toolsInherited'), 'A'));
  const result: Record<string, unknown>[] = [], subAgents: string[] = [], grants = new Map<string, string[]>();
  const has = (names: readonly string[]) => tools.some(tool => names.includes(tool) && !disallowed.includes(tool));
  if (has(fileTools)) {
    const readonly = !has(writing);
    result.push({ type: 'filesystem', ...(readonly ? { readonly: true } : {}) });
    diagnostics.push(diagnostic('warning', 'toolset-approximated', '/tools', say(readonly ? 'fileToolsReadonly' : 'fileTools'), 'A'));
  }
  if (has(['Bash'])) result.push({ type: 'shell' });
  if (has(['WebFetch'])) result.push({ type: 'fetch' });
  if (has(taskTools)) { result.push({ type: 'todo' }); diagnostics.push(diagnostic('warning', 'toolset-approximated', '/tools', say('taskTools'), 'A')); }
  if (has(['AskUserQuestion'])) { result.push({ type: 'user_prompt' }); diagnostics.push(diagnostic('warning', 'toolset-approximated', '/tools', say('askUser'), 'A')); }
  for (const tool of tools) {
    const agent = /^Agent\((.+)\)$/.exec(tool), mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(tool);
    if (agent) subAgents.push(agent[1]!);
    else if (mcp) grants.set(mcp[1]!, [...(grants.get(mcp[1]!) ?? []), mcp[2]!]);
    else if (![...fileTools, ...taskTools, 'Bash', 'WebFetch', 'AskUserQuestion'].includes(tool)) diagnostics.push(diagnostic('warning', 'tool-unsupported', '/tools', say('toolUnsupported', { tool }), 'U'));
  }
  for (const tool of disallowed) if (!fileTools.includes(tool)) diagnostics.push(diagnostic('info', 'tool-unsupported', '/disallowedTools', say('disallowedUnsupported', { tool }), 'U'));
  if (metadata.memory !== undefined) {
    result.push({ type: 'memory' });
    diagnostics.push(diagnostic('warning', 'toolset-approximated', '/memory', say('memoryImported', { memory: String(metadata.memory) }), 'A'));
  }
  return { toolsets: [...result, ...mcpToolsets(metadata, grants, diagnostics)], subAgents };
}

function hooks(value: unknown, diagnostics: AgentDiagnostic[]): Record<string, unknown> | undefined {
  const result: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(record(value))) {
    const target = reverseEvents[event];
    if (!target) { diagnostics.push(diagnostic('warning', 'hook-unsupported', pointer('hooks', event), say('importHookUnsupported', { event }), 'U')); continue; }
    const tool = ['pre_tool_use', 'post_tool_use', 'permission_request'].includes(target);
    for (const group of Array.isArray(groups) ? groups.map(record) : []) {
      const handlers = (Array.isArray(group.hooks) ? group.hooks.map(record) : []).filter(handler => handler.type === 'command' && text(handler.command))
        .map(handler => ({ type: 'command', command: handler.command, ...(typeof handler.timeout === 'number' ? { timeout: Math.max(1, Math.round(handler.timeout)) } : {}) }));
      if (handlers.length === 0) continue;
      const matcher = typeof group.matcher === 'string' ? group.matcher.split('|').map(name => reverseTools[name] ?? name).join('|') : '*';
      result[target] = [...(result[target] ?? []), ...(tool ? [{ matcher, hooks: handlers }] : handlers)];
    }
    diagnostics.push(diagnostic('warning', 'hook-approximated', pointer('hooks', event), say('importHookApproximated', { event, target }), 'A'));
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** The docker-agent name of an imported Claude agent: characters other than letters, digits, `-` and `_` become `-`. */
export function importedName(name: unknown): string {
  return String(name).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

/**
 * Converts a Claude agent's frontmatter and prompt into a docker-agent agent definition (approximate). `Agent(x)`
 * tools become `sub_agents` only for agents in `knownAgents`, the agents of the target definition file.
 */
export function importClaudeAgent(metadata: Record<string, unknown>, prompt: string, defaultModel: string, knownAgents: readonly string[]): ImportedAgent {
  const diagnostics: AgentDiagnostic[] = [];
  const name = importedName(metadata.name);
  if (name !== metadata.name) diagnostics.push(diagnostic('info', 'name-sanitized', '/name', say('importNameSanitized', { name: String(metadata.name), imported: name }), 'E'));
  const source = record(metadata['x-forge-source']);
  if (text(source.path)) diagnostics.push(diagnostic('warning', 'generated-agent', '/x-forge-source', say('generatedAgent', { source: `${String(source.path)}#${String(source.agent)}` }), 'A'));
  const { toolsets: imported, subAgents: delegates } = toolsets(metadata, diagnostics);
  const subAgents = delegates.filter(agent => knownAgents.includes(agent));
  if (subAgents.length > 0) diagnostics.push(diagnostic('warning', 'delegation-approximated', '/tools', say('subAgentsImported', { agents: subAgents.join(', ') }), 'A'));
  for (const agent of delegates.filter(entry => !subAgents.includes(entry))) {
    diagnostics.push(diagnostic('warning', 'delegation-unsupported', '/tools', say('subAgentMissing', { agent }), 'U'));
  }
  const mappedHooks = hooks(metadata.hooks, diagnostics);
  for (const field of unsupportedFields) if (metadata[field] !== undefined) diagnostics.push(diagnostic('info', 'field-unsupported', pointer(field), say('importFieldUnsupported', { field }), 'U'));
  for (const field of Object.keys(metadata)) if (!known.includes(field)) diagnostics.push(diagnostic('info', 'field-unsupported', pointer(field), say('unknownField', { field }), 'U'));
  if (metadata.maxTurns !== undefined) diagnostics.push(diagnostic('warning', 'max-iterations-approximated', '/maxTurns', say('maxTurnsImported'), 'A'));
  const skills = stringList(metadata.skills);
  if (skills.length > 0) diagnostics.push(diagnostic('warning', 'skills-approximated', '/skills', say('skillsImported'), 'A'));
  const agent: Record<string, unknown> = {
    model: model(metadata.model, defaultModel, diagnostics), description: metadata.description, instruction: prompt,
    ...(subAgents.length > 0 ? { sub_agents: subAgents } : {}),
    ...(imported.length > 0 ? { toolsets: imported } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(typeof metadata.maxTurns === 'number' ? { max_iterations: metadata.maxTurns } : {}),
    ...(mappedHooks ? { hooks: mappedHooks } : {}),
  };
  return { name, agent, diagnostics };
}
