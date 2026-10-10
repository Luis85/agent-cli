import type { FileRepository } from '../../../application/workspace/ports.ts';
import { vaultPath } from '../../../domain/documents/file.ts';
import { AppError, errorMessage } from '../../../domain/shared/errors.ts';
import {
  agentEntries, defaultAgent, diagnostic, hasErrors, instructionFiles, isObject, localPath, normalizedDocument, pointer, record,
  type AgentConfigDocument, type AgentDiagnostic,
} from '../domain/config.ts';
import { semanticDiagnostics } from '../domain/semantics.ts';
import { agentError } from '../domain/errors.ts';
import type { AgentPorts, ParsedDefinition } from './ports.ts';

/** One definition file read from the scope: the document when it parses, and every diagnostic in source order. */
export interface LoadedDefinition {
  path: string; revision: string; text: string;
  config?: AgentConfigDocument;
  diagnostics: AgentDiagnostic[];
  /** Resolved `instruction_file` contents by agent name. */
  instructions: Record<string, string>;
}

const definitionFile = /\.ya?ml$/;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
const byPosition = (left: AgentDiagnostic, right: AgentDiagnostic) => (left.line ?? 0) - (right.line ?? 0) || (left.column ?? 0) - (right.column ?? 0);

/** The parent directory of a scope path, with a trailing slash, or '' at the root. */
const parent = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';

/**
 * docker-agent definition files in the scope's definitions directory (`plugins.settings.agents.directory`): listing,
 * loading with YAML, schema and semantic diagnostics, and resolving `instruction_file` references.
 */
export class AgentDefinitions {
  constructor(private readonly files: FileRepository, private readonly ports: Pick<AgentPorts, 'codec' | 'schema'>, readonly directory: string) {
    vaultPath(directory);
  }

  /** Definition files directly in the directory, sorted. */
  async paths(): Promise<string[]> {
    const prefix = `${this.directory}/`;
    return (await this.files.list()).filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && definitionFile.test(path)).sort();
  }

  /** A command's file argument: a bare file name lives in the definitions directory; a path is scope-relative. */
  resolve(file: string): string {
    return vaultPath(file.includes('/') ? file : `${this.directory}/${file}`);
  }

  /** Parse, schema and semantic diagnostics for definition text; positions come from the YAML source. */
  check(text: string): { config?: AgentConfigDocument; diagnostics: AgentDiagnostic[]; locate: ParsedDefinition['locate'] } {
    const parsed = this.ports.codec.parse(text);
    if (parsed.value === undefined) return { diagnostics: parsed.diagnostics, locate: parsed.locate };
    const value = normalizedDocument(parsed.value);
    const schema = this.ports.schema.validate(value);
    const config = isObject(value) ? value : undefined;
    const semantic = config ? semanticDiagnostics(config, this.ports.schema.configVersion) : [];
    const diagnostics = [...schema, ...semantic].map(entry => ({ ...entry, ...parsed.locate(entry.pointer) }));
    return { ...(config ? { config } : {}), diagnostics: diagnostics.sort(byPosition), locate: parsed.locate };
  }

  async load(path: string): Promise<LoadedDefinition> {
    const snapshot = await this.files.read(path);
    let text: string;
    try { text = decoder.decode(snapshot.bytes); }
    catch { return { path, revision: snapshot.revision, text: '', diagnostics: [diagnostic('error', 'encoding', '', 'Definition files must be valid UTF-8.')], instructions: {} }; }
    const checked = this.check(text);
    const instructions: Record<string, string> = {}, missing: AgentDiagnostic[] = [];
    if (checked.config && !hasErrors(checked.diagnostics)) {
      for (const [name, agent] of agentEntries(checked.config)) {
        const files = instructionFiles(agent);
        if (files.length === 0) continue;
        const parts: string[] = [];
        for (const [index, file] of files.entries()) {
          const at = typeof agent.instruction_file === 'string' ? pointer('agents', name, 'instruction_file') : pointer('agents', name, 'instruction_file', index);
          try { parts.push(decoder.decode((await this.files.read(vaultPath(`${parent(path)}${localPath(file)!}`))).bytes)); }
          catch (error) {
            const reason = error instanceof AppError && error.code === 'NOT_FOUND' ? 'does not exist' : `cannot be read: ${errorMessage(error).replace(/\.$/, '')}`;
            missing.push({ ...diagnostic('error', 'instruction-file-missing', at, `instruction_file "${file}" ${reason}.`), ...checked.locate(at) });
          }
        }
        instructions[name] = parts.join('\n\n');
      }
    }
    return { path, revision: snapshot.revision, text, ...(checked.config ? { config: checked.config } : {}), diagnostics: [...checked.diagnostics, ...missing].sort(byPosition), instructions };
  }

  /** Every definition file with its agents, the default agent and diagnostic counts. */
  async list() {
    const files = await Promise.all((await this.paths()).map(async path => {
      const loaded = await this.load(path);
      const config = loaded.config;
      return {
        path, revision: loaded.revision, valid: !hasErrors(loaded.diagnostics),
        ...(config && config.version !== undefined ? { version: config.version } : {}),
        default: config ? defaultAgent(config) ?? null : null,
        agents: config ? agentEntries(config).map(([name, agent]) => ({
          name, ...(typeof agent.description === 'string' ? { description: agent.description } : {}),
          ...(typeof agent.model === 'string' ? { model: agent.model } : {}),
          subAgents: Array.isArray(agent.sub_agents) ? agent.sub_agents : [],
        })) : [],
        errors: loaded.diagnostics.filter(entry => entry.severity === 'error').length,
        warnings: loaded.diagnostics.filter(entry => entry.severity === 'warning').length,
      };
    }));
    return { directory: this.directory, files };
  }

  /** One file, or one agent of it with `file#agent`. */
  async inspect(target: string) {
    const hash = target.indexOf('#');
    const path = this.resolve(hash < 0 ? target : target.slice(0, hash)), name = hash < 0 ? undefined : target.slice(hash + 1);
    const loaded = await this.load(path);
    const config = loaded.config;
    if (name === undefined) {
      return { path, revision: loaded.revision, valid: !hasErrors(loaded.diagnostics), default: config ? defaultAgent(config) ?? null : null, config: config ?? null, diagnostics: loaded.diagnostics };
    }
    const agents = record(config?.agents);
    if (!Object.hasOwn(agents, name)) throw agentError('AGENT_NOT_FOUND', `${path} defines no agent ${name}; defined: ${Object.keys(agents).join(', ') || 'none'}.`, { path, agent: name, agents: Object.keys(agents) });
    return {
      path, revision: loaded.revision, agent: name, default: defaultAgent(config!) === name, definition: agents[name],
      ...(Object.hasOwn(loaded.instructions, name) ? { instruction: loaded.instructions[name] } : {}),
      diagnostics: loaded.diagnostics.filter(entry => entry.pointer === '' || !entry.pointer.startsWith('/agents/') || entry.pointer.startsWith(pointer('agents', name))),
    };
  }

  /** Validates one file or every file; any error-severity diagnostic fails with INVALID_AGENT_DEFINITION. */
  async validate(file?: string) {
    const paths = file === undefined ? await this.paths() : [this.resolve(file)];
    const files = await Promise.all(paths.map(async path => {
      const loaded = await this.load(path);
      return { path, revision: loaded.revision, valid: !hasErrors(loaded.diagnostics), diagnostics: loaded.diagnostics };
    }));
    const invalid = files.filter(entry => !entry.valid);
    if (invalid.length > 0) {
      throw agentError('INVALID_AGENT_DEFINITION', `${invalid.map(entry => `${entry.path} (${entry.diagnostics.filter(item => item.severity === 'error').length} errors)`).join(', ')} failed validation; see details.files[].diagnostics.`, { files: invalid });
    }
    return { directory: this.directory, valid: true, files };
  }
}
