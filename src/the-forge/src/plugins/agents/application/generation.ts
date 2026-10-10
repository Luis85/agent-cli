import type { Workspace } from '../../../application/workspace/workspace.ts';
import type { EventChannel } from '../../../application/plugins/events.ts';
import { GenerationService } from '../../../application/generation/plans.ts';
import type { GenerationMode } from '../../../application/generation/controls.ts';
import { AppError, forgeError } from '../../../domain/shared/errors.ts';
import type { WriteRequest } from '../../../domain/documents/file.ts';
import { hasErrors, isObject, record } from '../domain/config.ts';
import { generateClaude, type ClaudeGenerationOptions, type DefinitionSource } from '../domain/claude-generation.ts';
import { mergeMcpServers, mergeSettings } from '../domain/claude-merge.ts';
import { agentError } from '../domain/errors.ts';
import type { AgentDefinitions } from './definitions.ts';
import type { FrontmatterCodec } from './ports.ts';

export interface GenerateRequest extends Omit<ClaudeGenerationOptions, 'agents'> {
  file?: string; agent?: string;
  mode: GenerationMode; manifestPath?: string; revisions?: Record<string, string>;
}
/** `hand-edited`: the output differs although its provenance matches the current source, or it has none. */
type OutputStatus = 'unchanged' | 'changed' | 'missing' | 'hand-edited';

const mcpPath = '.mcp.json', settingsPath = '.claude/settings.json';
const decoder = new TextDecoder('utf-8', { fatal: true });
const encode = (text: string) => new TextEncoder().encode(text);

/**
 * `agents generate --target claude`: definitions → Claude agents (and opt-in MCP, settings and skill files) through
 * the shared generation review pattern. Plans and checks never write; `--check` fails with AGENT_DRIFT listing
 * missing, changed, hand-edited and stale outputs; regeneration of existing files needs `--revisions-from`.
 */
export class AgentGeneration {
  constructor(
    private readonly workspace: Workspace, private readonly definitions: AgentDefinitions,
    private readonly markdown: FrontmatterCodec, private readonly events: EventChannel,
  ) {}

  async run(request: GenerateRequest) {
    const sources = await this.sources(request);
    const generated = generateClaude(sources, { mcp: request.mcp, settings: request.settings, commands: request.commands, modelStyle: request.modelStyle, ...(request.agent ? { agents: [request.agent] } : {}) });
    if (hasErrors(generated.diagnostics)) {
      throw agentError('INVALID_AGENT_DEFINITION', 'The definitions cannot be generated together; see details.diagnostics.', { diagnostics: generated.diagnostics.filter(entry => entry.severity === 'error') });
    }
    const markdown = [...generated.agents, ...generated.skills];
    const writes: WriteRequest[] = markdown.map(file => ({ path: file.path, bytes: encode(this.markdown.render(file.metadata, file.body)) }));
    if (request.mcp === 'project' && Object.keys(generated.mcpServers).length > 0) writes.push({ path: mcpPath, bytes: encode(mergeMcpServers(mcpPath, await this.text(mcpPath), generated.mcpServers)) });
    if (generated.settings) writes.push({ path: settingsPath, bytes: encode(mergeSettings(settingsPath, await this.text(settingsPath), generated.settings)) });
    const generation = new GenerationService(this.workspace);
    const plan = await generation.plan(writes, request.mode === 'plan' ? request.manifestPath : undefined);
    const provenance = new Map(markdown.map(file => [file.path, record(file.metadata['x-forge-source']).sha256]));
    const outputs = plan.outputs.map(output => ({ ...output, status: this.status(output, provenance.get(output.path)) }));
    const stale = request.agent ? [] : await this.stale(new Set(sources.map(source => source.path)), new Set(writes.map(write => write.path)));
    const summary = {
      target: 'claude',
      agents: generated.agents.map(({ path, name, agent, source }) => ({ agent, name, path, source })),
      skills: generated.skills.map(skill => skill.path),
      files: outputs.map(({ path, status }) => ({ path, status })), stale,
      diagnostics: generated.diagnostics,
    };
    if (request.mode === 'check') {
      const drift = outputs.filter(output => output.status !== 'unchanged').map(({ path, status }) => ({ path, status }));
      if (drift.length > 0 || stale.length > 0) {
        throw agentError('AGENT_DRIFT', `Generated Claude files differ from their definitions: ${[...drift.map(entry => `${entry.path} (${entry.status})`), ...stale.map(path => `${path} (stale)`)].join(', ')}. Run agents generate with --plan to review.`, { outputs: drift, stale });
      }
      return { ...summary, check: true, matches: true };
    }
    if (request.mode === 'plan') return { ...summary, plan: true, matches: plan.matches && stale.length === 0, revisions: plan.revisions, outputs, ...(plan.manifest ? { manifest: plan.manifest } : {}) };
    const pending = new Set(outputs.filter(output => output.status !== 'unchanged').map(output => output.path));
    if (pending.size === 0) return { ...summary, dryRun: this.workspace.dryRun, changes: [] };
    const revisions = request.revisions && Object.fromEntries(Object.entries(request.revisions).filter(([path]) => pending.has(path)));
    const result = await generation.commit(writes.filter(write => pending.has(write.path)), revisions);
    if (!this.workspace.dryRun) {
      await this.events.emit('agents.generated', { target: 'claude', sources: sources.map(source => source.path), agents: summary.agents.map(entry => entry.name), files: [...pending] });
    }
    return { ...summary, ...result };
  }

  /** Loaded definitions to generate; any invalid file stops generation with its diagnostics. */
  private async sources(request: GenerateRequest): Promise<DefinitionSource[]> {
    const paths = request.file === undefined ? await this.definitions.paths() : [this.definitions.resolve(request.file)];
    const loaded = await Promise.all(paths.map(path => this.definitions.load(path)));
    const invalid = loaded.filter(file => hasErrors(file.diagnostics));
    if (invalid.length > 0) {
      throw agentError('INVALID_AGENT_DEFINITION', `${invalid.map(file => file.path).join(', ')} failed validation; run agents validate.`, { files: invalid.map(({ path, diagnostics }) => ({ path, diagnostics })) });
    }
    const sources = loaded.map(file => ({ path: file.path, sha256: file.revision, config: file.config!, instructions: file.instructions }));
    if (request.agent === undefined) return sources;
    const owner = sources.filter(source => Object.hasOwn(record(source.config.agents), request.agent!));
    if (owner.length === 0) throw agentError('AGENT_NOT_FOUND', `No definition in ${request.file === undefined ? `${this.definitions.directory}/` : paths[0]} defines agent ${request.agent}.`, { agent: request.agent });
    return owner;
  }

  private status(output: { path: string; status: 'unchanged' | 'changed' | 'missing'; currentContent?: string }, sha256: unknown): OutputStatus {
    if (output.status !== 'changed' || sha256 === undefined || output.currentContent === undefined) return output.status;
    try {
      const current = record(this.markdown.parse(output.currentContent).metadata['x-forge-source']);
      return current.sha256 === sha256 || current.sha256 === undefined ? 'hand-edited' : 'changed';
    } catch { return 'hand-edited'; }
  }

  /** Generated agent and skill files whose provenance names a generated source but that this run no longer produces. */
  private async stale(sources: ReadonlySet<string>, produced: ReadonlySet<string>): Promise<string[]> {
    const candidates = (await this.workspace.files.list()).filter(path => !produced.has(path)
      && (/^\.claude\/agents\/[^/]+\.md$/.test(path) || /^\.claude\/skills\/[^/]+\/SKILL\.md$/.test(path)));
    const stale: string[] = [];
    for (const path of candidates) {
      try {
        const text = await this.text(path);
        const source = text === undefined ? undefined : this.markdown.parse(text).metadata['x-forge-source'];
        if (isObject(source) && typeof source.path === 'string' && sources.has(source.path)) stale.push(path);
      } catch { /* Unreadable or hand-written files without frontmatter are not generated outputs. */ }
    }
    return stale;
  }

  private async text(path: string): Promise<string | undefined> {
    try { return decoder.decode((await this.workspace.files.read(path)).bytes); }
    catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') return undefined;
      if (error instanceof TypeError) throw forgeError('INVALID_ENCODING', `${path} is not valid UTF-8.`);
      throw error;
    }
  }
}
