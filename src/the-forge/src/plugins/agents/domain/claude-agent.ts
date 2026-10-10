import { diagnostic, instructionText, isObject, pointer, record, stringList, text, type AgentConfigDocument, type AgentDiagnostic } from './config.ts';
import { isExternalReference } from './references.ts';
import { claudeModel, type ModelStyle } from './claude-models.ts';
import { claudeTools, type ToolGrant } from './claude-tools.ts';
import { claudeHooks, type HookCommand } from './claude-hooks.ts';
import type { McpServer } from './claude-mcp.ts';
import type { PermissionRule } from './claude-permissions.ts';
import { templateExpressions } from './templating.ts';

/**
 * One generated Claude agent before rendering: frontmatter and the Markdown prompt. Tool grants, MCP servers and hooks
 * stay separate until generation applies the `--mcp` and `--hooks` opt-ins.
 */
export interface ClaudeAgentDraft {
  agent: string; name: string; metadata: Record<string, unknown>; prompt: string;
  grants: ToolGrant[]; disallowed: string[]; servers: McpServer[]; permissions: PermissionRule[];
  hooks?: Record<string, unknown[]>; hookCommands: HookCommand[];
}

/** Agent fields with no Claude agent equivalent: runtime limits, compaction, caching, safety and output shaping. */
const unsupportedFields = ['fallback', 'code_mode_tools', 'add_description_parameter', 'max_consecutive_tool_calls', 'max_old_tool_call_tokens', 'max_tool_result_tokens',
  'num_history_items', 'session_compaction', 'compaction_threshold', 'compaction_model', 'structured_output', 'cache', 'safety', 'redact_secrets', 'budgets'];

function templates(value: string, at: string): AgentDiagnostic[] {
  return templateExpressions(value).map(expression => expression.body.startsWith('env.')
    ? diagnostic('warning', 'template-literal', at, `${expression.source} is kept literally; Claude Code does not expand docker-agent environment expressions in agents.`, 'A')
    : diagnostic('warning', 'template-literal', at, `${expression.source} is kept literally; Claude Code cannot evaluate docker-agent template expressions.`, 'U'));
}

function promptOptions(name: string, agent: Record<string, unknown>): AgentDiagnostic[] {
  const at = (field: string) => pointer('agents', name, field);
  const diagnostics: AgentDiagnostic[] = [];
  if (agent.add_date === true) diagnostics.push(diagnostic('info', 'prompt-option-approximated', at('add_date'), 'Claude Code adds the current date to its system prompt itself.', 'A'));
  if (agent.add_environment_info === true) diagnostics.push(diagnostic('info', 'prompt-option-approximated', at('add_environment_info'), 'Claude Code adds working directory, platform and Git information to its system prompt itself.', 'A'));
  for (const field of ['add_prompt_files', 'add_prompt_files_depth']) if (agent[field] !== undefined) diagnostics.push(diagnostic('info', 'prompt-option-unsupported', at(field), `${field} is not emitted; Claude Code loads CLAUDE.md files instead.`, 'U'));
  if (agent.welcome_message !== undefined) diagnostics.push(diagnostic('info', 'prompt-option-unsupported', at('welcome_message'), 'Claude agents have no welcome message.', 'U'));
  return diagnostics;
}

function delegation(name: string, agent: Record<string, unknown>, names: ReadonlyMap<string, string>): { agents: string[]; diagnostics: AgentDiagnostic[] } {
  const diagnostics: AgentDiagnostic[] = [], local: string[] = [];
  stringList(agent.sub_agents).forEach((reference, index) => {
    if (isExternalReference(reference) || !names.has(reference)) diagnostics.push(diagnostic('warning', 'delegation-unsupported', pointer('agents', name, 'sub_agents', index), `The external sub-agent ${reference} is not generated.`, 'U'));
    else local.push(names.get(reference)!);
  });
  if (local.length > 0) diagnostics.push(diagnostic('warning', 'delegation-approximated', pointer('agents', name, 'sub_agents'), `Sub-agents become Agent(…) entries in tools, which Claude Code enforces only when ${names.get(name)} runs as the main thread.`, 'A'));
  for (const field of ['handoffs', 'force_handoff', 'routing']) if (agent[field] !== undefined) {
    diagnostics.push(diagnostic('warning', 'delegation-unsupported', pointer('agents', name, field), `${field} is not emitted; Claude delegates only through the Agent tool.`, 'U'));
  }
  return { agents: local, diagnostics };
}

function skills(name: string, agent: Record<string, unknown>): { skills: string[]; diagnostics: AgentDiagnostic[] } {
  const at = pointer('agents', name, 'skills'), value = agent.skills;
  if (value === undefined) return { skills: [], diagnostics: [] };
  if (!Array.isArray(value)) return { skills: [], diagnostics: [diagnostic('info', 'skills-approximated', at, value === true ? 'Claude Code discovers project and user skills itself.' : 'Skills are disabled; Claude agents cannot disable skill discovery.', 'A')] };
  const names = value.filter((entry): entry is string => typeof entry === 'string' && entry !== 'local' && !/^https?:\/\//.test(entry));
  const diagnostics = value.flatMap((entry, index) => isObject(entry)
    ? [diagnostic('warning', 'skills-unsupported', `${at}/${index}`, `The inline skill ${String(entry.name)} is not generated; write it as .claude/skills/${String(entry.name)}/SKILL.md.`, 'U')]
    : typeof entry === 'string' && !names.includes(entry) ? [diagnostic('info', 'skills-unsupported', `${at}/${index}`, `The skill source ${entry} is not emitted; Claude Code loads skills from .claude/skills.`, 'U')] : []);
  if (names.length > 0) diagnostics.push(diagnostic('warning', 'skills-approximated', at, 'Named skills are preloaded through the skills frontmatter; Claude Code resolves them by name.', 'A'));
  return { skills: names, diagnostics };
}

/** Maps one docker-agent agent to a Claude agent draft following the mapping table of the agents reference. */
export function claudeAgent(config: AgentConfigDocument, name: string, instructions: Readonly<Record<string, string>>, names: ReadonlyMap<string, string>, style: ModelStyle): { draft: ClaudeAgentDraft; diagnostics: AgentDiagnostic[] } {
  const agent = record(record(config.agents)[name]), at = pointer('agents', name), claude = names.get(name)!;
  const diagnostics: AgentDiagnostic[] = [];
  if (claude !== name) diagnostics.push(diagnostic('info', 'name-sanitized', at, `Agent ${name} is generated as ${claude}.`, 'E'));
  let description = typeof agent.description === 'string' ? agent.description : '';
  if (!text(description)) {
    description = `The ${name} agent.`;
    diagnostics.push(diagnostic('warning', 'description-synthesized', `${at}/description`, `The agent has no description; "${description}" is emitted so Claude Code can delegate to it.`, 'A'));
  }
  diagnostics.push(...templates(description, `${at}/description`));
  const instruction = instructionText(agent.instruction) ?? instructions[name] ?? '';
  diagnostics.push(...templates(instruction, agent.instruction === undefined ? `${at}/instruction_file` : `${at}/instruction`), ...promptOptions(name, agent));
  const model = claudeModel(config, name, agent, style), tools = claudeTools(config, name, agent), hooks = claudeHooks(name, agent.hooks);
  const delegates = delegation(name, agent, names), preloaded = skills(name, agent);
  diagnostics.push(...model.diagnostics, ...tools.diagnostics, ...hooks.diagnostics, ...delegates.diagnostics, ...preloaded.diagnostics);
  const granted: ToolGrant[] = [...tools.tools, ...delegates.agents.map(agentName => `Agent(${agentName})`)];
  const maxTurns = agent.max_iterations;
  if (typeof maxTurns === 'number' && maxTurns > 0) diagnostics.push(diagnostic('warning', 'max-iterations-approximated', `${at}/max_iterations`, `max_iterations is emitted as maxTurns: ${maxTurns}; Claude counts agentic turns, not model calls.`, 'A'));
  for (const field of unsupportedFields) if (agent[field] !== undefined) diagnostics.push(diagnostic('info', 'setting-unsupported', `${at}/${field}`, `${field} has no Claude agent equivalent and is not emitted.`, 'U'));
  const metadata: Record<string, unknown> = {
    name: claude, description,
    model: model.model, ...(model.effort ? { effort: model.effort } : {}),
    ...(typeof maxTurns === 'number' && maxTurns > 0 ? { maxTurns } : {}),
    ...(preloaded.skills.length > 0 ? { skills: preloaded.skills } : {}),
    ...(tools.memory ? { memory: 'project' } : {}),
  };
  const prompt = instruction === '' || instruction.endsWith('\n') ? instruction : `${instruction}\n`;
  return {
    draft: { agent: name, name: claude, metadata, prompt, grants: granted, disallowed: tools.disallowedTools, servers: tools.servers, permissions: tools.permissions, ...(hooks.hooks ? { hooks: hooks.hooks } : {}), hookCommands: hooks.commands },
    diagnostics,
  };
}
