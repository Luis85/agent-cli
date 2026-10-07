import { AppError, ensure } from '../domain/errors.ts';
import { vaultPath, type WriteRequest } from '../domain/file.ts';
import type { Workspace } from './workspace.ts';

/** Shared deterministic-generation review and explicit overwrite policy. */
export class GenerationService {
  constructor(private readonly workspace: Workspace) {}

  async commit(writes: readonly WriteRequest[], revisions?: Record<string, string>) {
    const paths = this.validate(writes);
    for (const [path, revision] of Object.entries(revisions ?? {})) {
      vaultPath(path);
      ensure(paths.has(path), 'INVALID_GENERATION_REVISIONS', `Revision path is outside this generation plan: ${path}.`);
      ensure(typeof revision === 'string' && /^[a-f0-9]{64}$/.test(revision), 'INVALID_GENERATION_REVISIONS', `Revision must be a SHA-256 hash: ${path}.`);
    }
    const plan = writes.map(write => ({ ...write, ...(revisions && Object.hasOwn(revisions, write.path) ? { expectedRevision: revisions[write.path] } : {}) }));
    try { return await this.write(plan); }
    catch (error) {
      if (error instanceof AppError && error.code === 'CONFLICT') throw new AppError('CONFLICT', 'Generated output already exists or changed after review. Rerun the same generation command with --plan-out <new-file.json>, review its outputs, then regenerate with --revisions-from <new-file.json>.', error.exitCode);
      throw error;
    }
  }

  /** Snapshot revisions independently from the later explicit write authorization. */
  async plan(writes: readonly WriteRequest[], manifestPath?: string) {
    const paths = this.validate(writes);
    const revisions: Record<string, string> = Object.create(null) as Record<string, string>;
    const outputs = await Promise.all(writes.map(async write => {
      const content = new TextDecoder().decode(write.bytes);
      try {
        const current = await this.workspace.files.read(write.path);
        revisions[write.path] = current.revision;
        const unchanged = current.bytes.length === write.bytes.length && current.bytes.every((byte, index) => byte === write.bytes[index]);
        return { path: write.path, status: unchanged ? 'unchanged' as const : 'changed' as const, revision: current.revision, content, ...(!unchanged ? { currentContent: new TextDecoder().decode(current.bytes) } : {}) };
      } catch (error) {
        if (error instanceof AppError && error.code === 'NOT_FOUND') return { path: write.path, status: 'missing' as const, content };
        throw error;
      }
    }));
    const orderedRevisions = Object.fromEntries(Object.entries(revisions).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    let manifest;
    if (manifestPath !== undefined) {
      vaultPath(manifestPath);
      ensure(![...paths].some(path => this.overlaps(path, manifestPath)), 'INVALID_GENERATION_PLAN', 'The revision manifest must be separate from generated outputs and their parent directories.');
      manifest = { path: manifestPath, ...await this.write([{ path: manifestPath, bytes: new TextEncoder().encode(JSON.stringify(orderedRevisions, null, 2) + '\n') }]) };
    }
    return { matches: outputs.every(output => output.status === 'unchanged'), revisions: orderedRevisions, outputs, ...(manifest ? { manifest } : {}) };
  }

  async check(writes: readonly WriteRequest[], errorCode = 'GENERATION_DRIFT') {
    const plan = await this.plan(writes);
    if (!plan.matches) throw new AppError(errorCode, 'Generated outputs are missing or differ from their definitions. Run the same command with --plan to review changes.', 5, { outputs: plan.outputs.map(({ path, status }) => ({ path, status })) });
    return plan;
  }

  private validate(writes: readonly WriteRequest[]) {
    const paths = new Set<string>();
    for (const write of writes) {
      vaultPath(write.path);
      ensure(![...paths].some(path => this.overlaps(path, write.path)), 'INVALID_GENERATION_PLAN', `Generated outputs overlap at ${write.path}.`);
      paths.add(write.path);
    }
    return paths;
  }

  private overlaps(left: string, right: string): boolean {
    return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  }

  private async write(plan: readonly WriteRequest[]) {
    const result = await this.workspace.write(plan);
    return { ...result, ...(this.workspace.dryRun ? { preview: plan.map(file => ({ path: file.path, content: new TextDecoder().decode(file.bytes) })) } : {}) };
  }
}
