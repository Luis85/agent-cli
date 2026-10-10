import type { Workspace } from '../../../application/workspace/workspace.ts';
import { vaultPath, type FileSnapshot } from '../../../domain/documents/file.ts';
import { revisionConflict } from '../../../domain/documents/write-plan.ts';
import { validateClaudeAgent } from '../../../domain/claude/agents.ts';
import { AppError, ensure } from '../../../domain/shared/errors.ts';
import { hasErrors, record, type AgentDiagnostic } from '../domain/config.ts';
import { importClaudeAgent, importedName } from '../domain/claude-import.ts';
import { agentError } from '../domain/errors.ts';
import { templateAgents, type AgentTemplate } from '../domain/templates.ts';
import type { AgentDefinitions } from './definitions.ts';
import type { AgentPorts } from './ports.ts';

/** Toolset types `agents create --toolset` adds; the others need settings such as a command or URL. */
export const simpleToolsets = ['filesystem', 'shell', 'fetch', 'think', 'todo', 'tasks', 'memory', 'user_prompt', 'calculator', 'random', 'datetime',
  'environment', 'git', 'plan', 'session_context', 'background_jobs', 'background_agents', 'scheduler', 'mcp_catalog', 'file'] as const;
export interface CreateRequest {
  name: string; file?: string; model?: string; description?: string; instruction?: string; toolsets?: readonly string[]; ifMatch?: string;
  /** A bundled template; it adds its agents instead of one agent with `toolsets`. */
  template?: AgentTemplate;
}
type AgentEntry = [name: string, agent: Record<string, unknown>];

const agentName = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Adds agents to docker-agent definition files: new ones from options, or converted from Claude agents. */
export class AgentAuthoring {
  constructor(
    private readonly workspace: Workspace, private readonly definitions: AgentDefinitions,
    private readonly ports: AgentPorts, private readonly defaultModel: string,
  ) {}

  /**
   * `agents create`: a valid docker-agent agent in a new file, or added to an existing team file; with a template,
   * the template's agents (`team` adds `<name>-researcher` and `<name>-writer` sub-agents).
   */
  async create(request: CreateRequest) {
    ensure(agentName.test(request.name), 'INVALID_NAME', 'Agent names start with a letter or digit and contain only letters, digits, hyphens and underscores.');
    const model = request.model ?? this.defaultModel;
    const text = { ...(request.description ? { description: request.description } : {}), ...(request.instruction ? { instruction: request.instruction } : {}) };
    if (request.template) return this.add(request.file ?? `${request.name}.yaml`, templateAgents(request.template, request.name, model, text), request.ifMatch, []);
    const description = request.description ?? `The ${request.name} agent.`;
    const agent: Record<string, unknown> = {
      model, description,
      instruction: `${(request.instruction ?? description).trimEnd()}\n`,
      ...(request.toolsets && request.toolsets.length > 0 ? { toolsets: request.toolsets.map(type => ({ type })) } : {}),
    };
    return this.add(request.file ?? `${request.name}.yaml`, [[request.name, agent]], request.ifMatch, []);
  }

  /**
   * `agents import --from claude`: converts `.claude/agents/<name>.md` (or a Markdown path) into a docker-agent
   * agent. The conversion is approximate; its diagnostics point into the Claude agent's frontmatter.
   */
  async importClaude(source: string, options: { file?: string; ifMatch?: string }) {
    const path = vaultPath(source.includes('/') || source.endsWith('.md') ? source : `.claude/agents/${source}.md`);
    const snapshot = await this.workspace.files.read(path);
    const { metadata, body } = this.ports.markdown.parse(decoder.decode(snapshot.bytes));
    validateClaudeAgent(metadata, body);
    const file = options.file ?? `${importedName(metadata.name)}.yaml`;
    const known = await this.knownAgents(this.definitions.target(file));
    const imported = importClaudeAgent(metadata, body, this.defaultModel, known);
    const diagnostics = imported.diagnostics.map(entry => ({ ...entry, path }));
    return { from: { target: 'claude', path, revision: snapshot.revision }, ...await this.add(file, [[imported.name, imported.agent]], options.ifMatch, diagnostics) };
  }

  private async knownAgents(path: string): Promise<string[]> {
    const current = await this.current(path);
    if (!current) return [];
    return Object.keys(record(this.definitions.check(decoder.decode(current.bytes)).config?.agents));
  }

  private async current(path: string): Promise<FileSnapshot | undefined> {
    try { return await this.workspace.files.read(path); }
    catch (error) { if (error instanceof AppError && error.code === 'NOT_FOUND') return undefined; throw error; }
  }

  /** Adds `entries` (the first is the main agent) to a new file, or to an existing one at its `--if-match` revision. */
  private async add(file: string, entries: readonly AgentEntry[], ifMatch: string | undefined, extra: Array<AgentDiagnostic & { path?: string }>) {
    const path = this.definitions.target(file), current = await this.current(path), names = entries.map(([name]) => name), name = names[0]!;
    let text: string;
    if (current) {
      ensure(ifMatch !== undefined, 'CONFLICT', `${path} exists; pass its current revision with --if-match to add ${names.join(', ')} to it.`, revisionConflict(path, null, current.revision));
      ensure(ifMatch === current.revision, 'CONFLICT', `${path} changed; read it again and pass its current revision with --if-match.`, revisionConflict(path, ifMatch, current.revision));
      text = decoder.decode(current.bytes);
      const defined = record(this.definitions.check(text).config?.agents), existing = names.find(entry => Object.hasOwn(defined, entry));
      if (existing !== undefined) throw agentError('AGENT_EXISTS', `${path} already defines agent ${existing}.`, { path, agent: existing });
      for (const [entry, agent] of entries) text = this.ports.codec.addAgent(text, entry, agent);
    } else {
      ensure(ifMatch === undefined, 'CONFLICT', `${path} does not exist; omit --if-match to create it.`, revisionConflict(path, ifMatch, null));
      text = this.ports.codec.render({ version: this.ports.schema.configVersion, agents: Object.fromEntries(entries) });
    }
    const checked = this.definitions.check(text);
    if (hasErrors(checked.diagnostics)) {
      throw agentError('INVALID_AGENT_DEFINITION', `Adding ${names.join(', ')} would leave ${path} invalid; see details.files[].diagnostics.`, { files: [{ path, diagnostics: checked.diagnostics }] });
    }
    const result = await this.workspace.write([{ path, bytes: new TextEncoder().encode(text), ...(current ? { expectedRevision: current.revision } : {}) }], { diff: true });
    return { path, agent: name, agents: names, created: !current, diagnostics: [...extra, ...checked.diagnostics.map(entry => ({ ...entry, path }))], ...result };
  }
}
