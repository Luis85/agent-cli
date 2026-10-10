import { AppError, ensure } from '../../domain/shared/errors.ts';
import { vaultPath, type WriteRequest } from '../../domain/documents/file.ts';
import type { Workspace } from '../workspace/workspace.ts';

/** Values supplied by a caller are data, never executable template expressions. */
export interface TemplateOptions {
  title: string;
  values?: Record<string, unknown>;
  /** ISO date or timestamp. Rendering uses UTC for reproducible agent workflows. */
  date?: string;
  dateFormat?: string;
  timeFormat?: string;
}

export interface TemplateInspection {
  /** Unique placeholder expressions, including built-in names and date formats. */
  variables: string[];
  /** Caller-supplied value keys; excludes title, date and time. */
  requiredVariables: string[];
  /** Built-in expressions, preserving explicit date/time formats. */
  builtins: string[];
}

export interface TemplateArtifact { path: string; content: string }

/** Install editable templates without replacing user-maintained definitions. */
export class TemplateInstaller {
  constructor(private readonly workspace: Workspace, private readonly artifacts: readonly TemplateArtifact[]) {}
  async install() {
    const candidates = this.artifacts.map(artifact => ({ path: `bin/templates/${vaultPath(artifact.path)}`, bytes: new TextEncoder().encode(artifact.content) }));
    ensure(new Set(candidates.map(candidate => candidate.path)).size === candidates.length, 'INVALID_TEMPLATE_PACK', 'Template destinations must be unique.');
    const writes: WriteRequest[] = [], skipped: string[] = [];
    for (const candidate of candidates) {
      try { await this.workspace.files.read(candidate.path); skipped.push(candidate.path); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
        writes.push(candidate);
      }
    }
    const result = writes.length ? await this.workspace.write(writes) : { dryRun: this.workspace.dryRun, changes: [] };
    return { directory: 'bin/templates', ...result, skipped, ...(this.workspace.dryRun ? { preview: writes.map(write => ({ path: write.path, content: new TextDecoder().decode(write.bytes) })) } : {}) };
  }
}

export interface DocumentTemplates {
  inspect(bytes: Uint8Array): TemplateInspection;
  render(bytes: Uint8Array, options: TemplateOptions): Uint8Array;
}
