import { validateClaudeAgent } from '../../../domain/claude/agents.ts';
import { agentEntries, defaultAgent, diagnostic, pointer, record, stringList, type AgentConfigDocument, type AgentDiagnostic } from './config.ts';
import { claudeName, permissionRules } from './claude-vocabulary.ts';
import { claudeAgent, type ClaudeAgentDraft } from './claude-agent.ts';
import { commandSkills, type CommandSkill } from './claude-commands.ts';
import type { ModelStyle } from './claude-models.ts';

export interface ClaudeGenerationOptions {
  /** `inline` puts MCP servers in agent frontmatter; `project` merges them into `.mcp.json`. */
  mcp: 'inline' | 'project';
  /** Merge permissions and the main agent into `.claude/settings.json`. */
  settings: boolean;
  /** Generate `.claude/skills/<name>/SKILL.md` from commands. */
  commands: boolean;
  modelStyle: ModelStyle;
  /** Generate only these docker-agent agents (by their definition names). */
  agents?: readonly string[];
}
/** One definition file: its scope path and revision (SHA-256), parsed document and resolved instruction files by agent. */
export interface DefinitionSource { path: string; sha256: string; config: AgentConfigDocument; instructions: Readonly<Record<string, string>> }
/** A diagnostic of the definition file at `path`. */
export interface GenerationDiagnostic extends AgentDiagnostic { path: string }
export interface GeneratedMarkdown { path: string; metadata: Record<string, unknown>; body: string }
export interface ClaudeGeneration {
  agents: Array<GeneratedMarkdown & { name: string; agent: string; source: string }>;
  skills: GeneratedMarkdown[];
  /** Servers for the project's `.mcp.json` (`mcp: project`). */
  mcpServers: Record<string, Record<string, unknown>>;
  /** Project settings to merge (`settings`). */
  settings?: { permissions: { allow: string[]; ask: string[]; deny: string[] }; agent?: string };
  diagnostics: GenerationDiagnostic[];
}

const frontmatterOrder = ['name', 'description', 'tools', 'disallowedTools', 'model', 'effort', 'maxTurns', 'skills', 'memory', 'mcpServers', 'hooks', 'x-forge-source'];
const ordered = (metadata: Record<string, unknown>) => Object.fromEntries(frontmatterOrder.filter(key => metadata[key] !== undefined).map(key => [key, metadata[key]]));
const unsupportedTopLevel = ['metadata', 'runtime', 'budget', 'budgets', 'flavors', 'evaluators', 'providers'];
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Project `.mcp.json` names are shared by every agent: equal servers merge, different ones get a numbered name. */
function projectServers(drafts: ClaudeAgentDraft[], servers: Record<string, Record<string, unknown>>) {
  for (const draft of drafts) {
    const names: string[] = [];
    for (const server of draft.servers) {
      let name = server.name;
      for (let index = 2; servers[name] && !same(servers[name], server.config); index++) name = `${server.name}-${index}`;
      servers[name] = server.config;
      names.push(name);
      if (name !== server.name) draft.metadata.tools = String(draft.metadata.tools).replaceAll(`mcp__${server.name}__`, `mcp__${name}__`);
    }
    if (names.length > 0) draft.metadata.mcpServers = names;
  }
}

function settingsPermissions(source: DefinitionSource, drafts: ClaudeAgentDraft[], diagnostics: AgentDiagnostic[]) {
  const permissions = { allow: drafts.flatMap(draft => draft.permissions.allow), ask: [] as string[], deny: drafts.flatMap(draft => draft.permissions.deny) };
  for (const list of ['allow', 'ask', 'deny'] as const) {
    const patterns = stringList(record(source.config.permissions)[list]);
    patterns.forEach((pattern, index) => {
      const rules = permissionRules(pattern);
      if (rules.length === 0) diagnostics.push(diagnostic('info', 'permission-unsupported', pointer('permissions', list, index), `The permission pattern ${pattern} has no Claude rule and is not emitted.`, 'U'));
      permissions[list].push(...rules);
    });
    if (patterns.length > 0) diagnostics.push(diagnostic('warning', 'permission-approximated', pointer('permissions', list), `permissions.${list} becomes Claude permission rules in .claude/settings.json; argument matching is approximated.`, 'A'));
  }
  return permissions;
}

function generateSource(source: DefinitionSource, names: ReadonlyMap<string, string>, options: ClaudeGenerationOptions) {
  const diagnostics: AgentDiagnostic[] = [], drafts: ClaudeAgentDraft[] = [], skills: CommandSkill[] = [];
  const selected = agentEntries(source.config).filter(([name]) => !options.agents || options.agents.includes(name));
  for (const [name, agent] of selected) {
    const result = claudeAgent(source.config, name, source.instructions, names, options.modelStyle);
    diagnostics.push(...result.diagnostics);
    drafts.push(result.draft);
    const commands = commandSkills(source.config, name, agent, names);
    if (options.commands) { skills.push(...commands.skills); diagnostics.push(...commands.diagnostics); }
    else if (commands.skills.length > 0) diagnostics.push(diagnostic('info', 'commands-not-generated', pointer('agents', name, 'commands'), 'Commands become Claude skills with --commands.', 'U'));
  }
  for (const key of unsupportedTopLevel) if (source.config[key] !== undefined) diagnostics.push(diagnostic('info', 'setting-unsupported', pointer(key), `The top-level ${key} section has no Claude equivalent and is not emitted.`, 'U'));
  if (!options.settings && source.config.permissions !== undefined) diagnostics.push(diagnostic('info', 'permissions-not-generated', '/permissions', 'Permissions become project settings rules with --settings.', 'U'));
  if (options.mcp === 'inline') for (const draft of drafts) if (draft.servers.length > 0) draft.metadata.mcpServers = draft.servers.map(server => ({ [server.name]: server.config }));
  return { drafts, skills, diagnostics, permissions: options.settings ? settingsPermissions(source, drafts, diagnostics) : undefined };
}

/** Skills share one namespace: identical skills merge, conflicting names are prefixed with their agent. */
function uniqueSkills(skills: Array<CommandSkill & { source: DefinitionSource }>, diagnostics: GenerationDiagnostic[]): GeneratedMarkdown[] {
  const byName = new Map<string, Array<CommandSkill & { source: DefinitionSource }>>();
  for (const skill of skills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  return [...byName.values()].flatMap(group => {
    const identical = group.every(skill => same(skill.metadata, group[0]!.metadata) && skill.body === group[0]!.body);
    return (identical ? [group[0]!] : group).map(skill => {
      const name = identical ? skill.name : claudeName(`${skill.agent}-${skill.command}`);
      if (!identical) diagnostics.push({ ...diagnostic('warning', 'command-renamed', pointer('agents', skill.agent, 'commands', skill.command), `Several agents define a different /${skill.command}; this one becomes the skill ${name}.`, 'A'), path: skill.source.path });
      const metadata = { ...skill.metadata, name, 'x-forge-source': { path: skill.source.path, sha256: skill.source.sha256, agent: skill.agent, command: skill.command } };
      return { path: `.claude/skills/${name}/SKILL.md`, metadata, body: skill.body };
    });
  });
}

/**
 * Generates Claude Code artifacts from docker-agent definitions: a pure function from parsed definitions to files and
 * diagnostics. Each agent becomes `.claude/agents/<name>.md` with `x-forge-source` provenance and passes Forge's
 * Claude agent validation; MCP servers, settings and command skills follow the options. Agent names that collide
 * after sanitizing are reported as errors and generate nothing.
 */
export function generateClaude(sources: readonly DefinitionSource[], options: ClaudeGenerationOptions): ClaudeGeneration {
  const names = new Map<string, string>(), owners = new Map<string, string>(), diagnostics: GenerationDiagnostic[] = [];
  for (const source of sources) for (const [name] of agentEntries(source.config)) {
    const claude = claudeName(name), owner = owners.get(claude);
    if (owner !== undefined) diagnostics.push({ ...diagnostic('error', 'agent-name-collision', pointer('agents', name), `Agent ${name} would generate .claude/agents/${claude}.md, which ${owner} already generates.`), path: source.path });
    owners.set(claude, `${source.path}#${name}`);
    names.set(name, claude);
  }
  const output: ClaudeGeneration = { agents: [], skills: [], mcpServers: {}, diagnostics };
  if (diagnostics.length > 0) return output;
  const skills: Array<CommandSkill & { source: DefinitionSource }> = [], permissions = { allow: [] as string[], ask: [] as string[], deny: [] as string[] };
  for (const source of sources) {
    const generated = generateSource(source, names, options);
    if (options.mcp === 'project') projectServers(generated.drafts, output.mcpServers);
    for (const draft of generated.drafts) {
      const metadata = ordered({ ...draft.metadata, 'x-forge-source': { path: source.path, sha256: source.sha256, agent: draft.agent } });
      validateClaudeAgent(metadata, draft.prompt);
      output.agents.push({ path: `.claude/agents/${draft.name}.md`, name: draft.name, agent: draft.agent, source: source.path, metadata, body: draft.prompt });
    }
    skills.push(...generated.skills.map(skill => ({ ...skill, source })));
    for (const list of ['allow', 'ask', 'deny'] as const) permissions[list].push(...(generated.permissions?.[list] ?? []));
    diagnostics.push(...generated.diagnostics.map(entry => ({ ...entry, path: source.path })));
  }
  output.skills = uniqueSkills(skills, diagnostics);
  if (options.settings) {
    const main = sources.length === 1 ? defaultAgent(sources[0]!.config) : undefined;
    const agent = main !== undefined && output.agents.some(entry => entry.agent === main && entry.source === sources[0]!.path) ? names.get(main) : undefined;
    if (agent !== undefined) diagnostics.push({ ...diagnostic('warning', 'main-agent-approximated', pointer('agents', main!), `The default agent ${main} becomes the project's main agent ("agent": "${agent}").`, 'A'), path: sources[0]!.path });
    output.settings = { permissions: Object.fromEntries(Object.entries(permissions).map(([list, rules]) => [list, [...new Set(rules)]])) as typeof permissions, ...(agent ? { agent } : {}) };
  }
  output.diagnostics = dedupe(diagnostics);
  return output;
}

/** One diagnostic per path, pointer, code and message: shared models and toolsets are reported once. */
function dedupe(diagnostics: GenerationDiagnostic[]): GenerationDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter(entry => {
    const key = JSON.stringify([entry.path, entry.pointer, entry.code, entry.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
