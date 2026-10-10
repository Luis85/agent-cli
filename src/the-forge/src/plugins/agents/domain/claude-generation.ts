import { validateClaudeAgent } from '../../../domain/claude/agents.ts';
import { agentEntries, defaultAgent, diagnostic, pointer, type AgentConfigDocument, type AgentDiagnostic } from './config.ts';
import { claudeName } from './claude-vocabulary.ts';
import { claudeAgent, type ClaudeAgentDraft } from './claude-agent.ts';
import { commandSkills, type CommandSkill } from './claude-commands.ts';
import type { ModelStyle } from './claude-models.ts';
import { completeAgent, type McpMode } from './claude-execution.ts';
import { reviewedRules, serverNames, topLevelRules, type PermissionRule } from './claude-permissions.ts';
import type { ForeignEntries } from './claude-merge.ts';

export interface ClaudeGenerationOptions {
  /** `none` (the default) writes no MCP servers; `inline` puts them in agent frontmatter; `project` merges them into `.mcp.json`. */
  mcp: McpMode;
  /** Emit agent hooks, which run commands. */
  hooks: boolean;
  /** Merge permissions and the main agent into `.claude/settings.json`. */
  settings: boolean;
  /** Write broad allow rules (`Bash`, `Edit`, `WebFetch`, a whole MCP server, …); without it they are errors. */
  allowBroadPermissions?: boolean;
  /** Generate `.claude/skills/<name>/SKILL.md` from commands. */
  commands: boolean;
  modelStyle: ModelStyle;
  /** Generate only these docker-agent agents (by their definition names). */
  agents?: readonly string[];
  /** Entries of the project's `.mcp.json` and settings that Forge does not own and must not replace. */
  foreign?: ForeignEntries;
  /** Give generated MCP servers whose name a foreign server uses a numbered name instead of failing. */
  renameConflicts?: boolean;
  /** Hash of the options that shape agent files (`--mcp`, `--hooks`, `--model-style`), recorded in their provenance. */
  optionsHash?: string;
}
/**
 * One definition file: its scope path, parsed document and resolved instruction files by agent. `sourceHash` covers
 * the file and its instruction files, so provenance changes when either does.
 */
export interface DefinitionSource { path: string; sourceHash: string; config: AgentConfigDocument; instructions: Readonly<Record<string, string>> }
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

/**
 * Project `.mcp.json` names are shared by every agent: equal servers merge, different ones get a numbered name. A
 * server the project defines that Forge does not own keeps its name: a generated server with that name and other
 * content is a conflict, or gets a numbered name with `renameConflicts`.
 */
function projectServers(drafts: ClaudeAgentDraft[], servers: Record<string, Record<string, unknown>>, options: ClaudeGenerationOptions, diagnostics: AgentDiagnostic[]) {
  const foreign = options.foreign?.servers ?? {};
  // A numbered name never lands on a foreign server; the declared name does only to report the conflict.
  const taken = (name: string, base: string, config: unknown) => (servers[name] !== undefined && !same(servers[name], config))
    || ((options.renameConflicts === true || name !== base) && foreign[name] !== undefined && !same(foreign[name], config));
  for (const server of drafts.flatMap(draft => draft.servers)) {
    const base = server.name;
    for (let index = 2; taken(server.name, base, server.config); index++) server.name = `${base}-${index}`;
    if (foreign[base] !== undefined && !same(foreign[base], server.config) && (server.name === base || options.renameConflicts === true)) {
      diagnostics.push(server.name === base
        ? diagnostic('error', 'mcp-server-conflict', server.at, `.mcp.json already defines the server ${base}, which Forge did not generate; rename the toolset's server or pass --rename-conflicts.`)
        : diagnostic('warning', 'mcp-server-renamed', server.at, `.mcp.json already defines a different server ${base}; this one is generated as ${server.name}.`, 'A'));
    }
    servers[server.name] = server.config;
  }
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
  return { drafts, skills, diagnostics };
}

/** The settings rules of one definition file: its agents' deny rules and its top-level permissions, reviewed. */
function settingsRules(source: DefinitionSource, drafts: readonly ClaudeAgentDraft[], options: ClaudeGenerationOptions, diagnostics: AgentDiagnostic[]): PermissionRule[] {
  const top = topLevelRules(source.config, serverNames(drafts), options.mcp);
  diagnostics.push(...top.diagnostics);
  return reviewedRules([...drafts.flatMap(draft => draft.permissions), ...top.rules], options.allowBroadPermissions === true, diagnostics);
}

/**
 * Skills share one namespace: identical skills merge, conflicting names are prefixed with their agent, and names that
 * still collide (such as `fix` and `Fix` of one agent) are errors that generate nothing, like agent name collisions.
 */
function uniqueSkills(skills: Array<CommandSkill & { source: DefinitionSource }>, diagnostics: GenerationDiagnostic[]): GeneratedMarkdown[] {
  const byName = new Map<string, Array<CommandSkill & { source: DefinitionSource }>>();
  for (const skill of skills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);
  const owners = new Map<string, string>();
  return [...byName.values()].flatMap(group => {
    const identical = group.every(skill => same(skill.metadata, group[0]!.metadata) && skill.body === group[0]!.body);
    return (identical ? [group[0]!] : group).flatMap(skill => {
      const name = identical ? skill.name : claudeName(`${skill.agent}-${skill.command}`), at = pointer('agents', skill.agent, 'commands', skill.command);
      const owner = owners.get(name), label = `/${skill.command} of ${skill.agent}`;
      if (owner !== undefined) {
        diagnostics.push({ ...diagnostic('error', 'command-name-collision', at, `The ${label} would generate .claude/skills/${name}/SKILL.md, which the ${owner} already generates; rename one of the commands.`), path: skill.source.path });
        return [];
      }
      owners.set(name, label);
      if (!identical) diagnostics.push({ ...diagnostic('warning', 'command-renamed', at, `Several agents define a different /${skill.command}; this one becomes the skill ${name}.`, 'A'), path: skill.source.path });
      const metadata = { ...skill.metadata, name, 'x-forge-source': { path: skill.source.path, agent: skill.agent, command: skill.command, sourceHash: skill.source.sourceHash } };
      return [{ path: `.claude/skills/${name}/SKILL.md`, metadata, body: skill.body }];
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
    if (options.mcp === 'project') projectServers(generated.drafts, output.mcpServers, options, generated.diagnostics);
    for (const draft of generated.drafts) {
      const metadata = ordered({ ...completeAgent(draft, options, generated.diagnostics), 'x-forge-source': { path: source.path, agent: draft.agent, sourceHash: source.sourceHash, ...(options.optionsHash ? { optionsHash: options.optionsHash } : {}) } });
      validateClaudeAgent(metadata, draft.prompt);
      output.agents.push({ path: `.claude/agents/${draft.name}.md`, name: draft.name, agent: draft.agent, source: source.path, metadata, body: draft.prompt });
    }
    skills.push(...generated.skills.map(skill => ({ ...skill, source })));
    if (options.settings) for (const rule of settingsRules(source, generated.drafts, options, generated.diagnostics)) permissions[rule.list].push(rule.rule);
    diagnostics.push(...generated.diagnostics.map(entry => ({ ...entry, path: source.path })));
  }
  output.skills = uniqueSkills(skills, diagnostics);
  if (options.settings) {
    const main = sources.length === 1 ? defaultAgent(sources[0]!.config) : undefined;
    const agent = main !== undefined && output.agents.some(entry => entry.agent === main && entry.source === sources[0]!.path) ? names.get(main) : undefined;
    if (agent !== undefined) diagnostics.push({ ...diagnostic('warning', 'main-agent-approximated', pointer('agents', main!), `The default agent ${main} becomes the project's main agent ("agent": "${agent}").`, 'A'), path: sources[0]!.path });
    const foreignAgent = options.foreign?.agent;
    if (agent !== undefined && foreignAgent !== undefined && foreignAgent !== agent) {
      diagnostics.push({ ...diagnostic('error', 'settings-agent-conflict', pointer('agents', main!), `.claude/settings.json already sets agent to ${foreignAgent}, which Forge did not generate; remove it to let Forge set ${agent}.`), path: sources[0]!.path });
    }
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
