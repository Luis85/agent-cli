import { forgeError, errorMessage, AppError, ensure } from '../../domain/shared/errors.ts';
import { vaultPath } from '../../domain/documents/file.ts';
import type { ClaudeAgentDocument } from '../../domain/claude/agents.ts';
import type { Workspace } from '../workspace/workspace.ts';

export interface ClaudeAgentCodec {
  parse(text: string): ClaudeAgentDocument;
  render(document: ClaudeAgentDocument): string;
}
interface AgentSummary {
  id: string; path: string; revision?: string; name?: string; description?: string;
  valid: boolean; error?: { code: string; message: string };
}

function text(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw forgeError('INVALID_ENCODING', 'Agent definitions must be valid UTF-8.'); }
}

/** Native definitions are addressed by filename, independently of their Claude agent names. */
export class ClaudeAgents {
  constructor(private readonly workspace: Workspace, private readonly codec: ClaudeAgentCodec, private readonly directory = '.claude/agents') {
    vaultPath(directory);
  }

  async list(): Promise<{ agents: AgentSummary[]; duplicates: string[] }> {
    const prefix = `${this.directory}/`;
    const paths = (await this.workspace.files.list()).filter(path => path.startsWith(prefix) && path.endsWith('.md')).sort();
    const agents: AgentSummary[] = [];
    const names = new Set<string>(), duplicates = new Set<string>();
    for (const path of paths) {
      const entry: AgentSummary = { id: path.slice(prefix.length, -3), path, valid: false };
      try {
        const snapshot = await this.workspace.files.read(path);
        entry.revision = snapshot.revision;
        const { metadata } = this.codec.parse(text(snapshot.bytes));
        entry.name = metadata.name as string;
        entry.description = metadata.description as string;
        entry.valid = true;
        if (names.has(entry.name)) duplicates.add(entry.name);
        names.add(entry.name);
      } catch (error) {
        entry.error = { code: error instanceof AppError ? error.code : 'OPERATION_FAILED', message: errorMessage(error) };
      }
      agents.push(entry);
    }
    return { agents, duplicates: [...duplicates].sort() };
  }

  async inspect(id: string) {
    const path = this.path(id), snapshot = await this.workspace.files.read(path);
    return { id, path, revision: snapshot.revision, bytes: snapshot.bytes.length, ...this.codec.parse(text(snapshot.bytes)) };
  }

  async create(id: string, source: string) { return this.write(id, source); }

  async update(id: string, source: string, revision: string) {
    this.requireRevision(revision);
    return this.write(id, source, revision);
  }

  async remove(id: string, revision: string) {
    this.requireRevision(revision);
    const path = this.path(id);
    // Deletion must remain available for malformed definitions discovered by list.
    return { id, path, ...await this.workspace.remove(path, revision) };
  }

  private path(id: string): string { return vaultPath(`${this.directory}/${vaultPath(id)}.md`); }
  private requireRevision(revision: string): void {
    ensure(typeof revision === 'string' && revision.length > 0, 'MISSING_ARGUMENT', 'A current revision is required to update or remove an agent.');
  }
  private async write(id: string, source: string, revision?: string) {
    const path = this.path(id), { metadata } = this.codec.parse(source);
    const result = await this.workspace.write([{ path, bytes: new TextEncoder().encode(source), ...(revision === undefined ? {} : { expectedRevision: revision }) }]);
    return { id, path, name: metadata.name, description: metadata.description, ...result,
      ...(this.workspace.dryRun ? { preview: [{ path, content: source }] } : {}),
    };
  }
}
