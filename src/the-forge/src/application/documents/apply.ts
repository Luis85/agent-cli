import { AppError, ensure, forgeError, locatedError } from '../../domain/shared/errors.ts';
import { revisionConflict } from '../../domain/documents/write-plan.ts';
import { editRequest, type ApplyPlan, type PlanOperation } from '../../domain/documents/apply-plan.ts';
import { EventBus } from '../plugins/events.ts';
import type { MetadataIndex } from '../metadata/ports.ts';
import { metadataChanges } from '../metadata/cache-events.ts';
import { FileManager } from '../vault/file-manager.ts';
import { Workspace } from '../workspace/workspace.ts';
import type { CommitObserver } from '../workspace/ports.ts';
import { StagedFiles } from './staged-files.ts';
import { plannedBatch } from './planned-batch.ts';
import { editBytes } from './text-edit.ts';

/** The scope a plan runs in; `workspaceScope` protects the workspace's `bin/` like `move` and `delete` do. */
export interface ApplyScope { workspace: Workspace; metadata: MetadataIndex; workspaceScope: boolean }
/** What one operation did in the planned state; `index` is its position in the plan. */
type Summary = { op: PlanOperation['op']; path: string } & Record<string, unknown>;
type OperationSummary = Summary & { index: number };

const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** Planning publishes nothing: its records would describe changes that are not committed yet. */
const silentEvents = () => new EventBus({ depth: () => 0, run: callback => callback() });

function contentBytes(content: string, encoding: 'utf8' | 'base64'): Uint8Array {
  if (encoding === 'utf8') return new TextEncoder().encode(content);
  const text = content.trim();
  ensure(base64.test(text), 'INVALID_ENCODING', 'Invalid base64 content.');
  return Uint8Array.from(atob(text), character => character.charCodeAt(0));
}

/** Prefixes a failure with the operation that caused it and records its index in `details.operation`. */
function located(error: unknown, index: number, op: string): unknown {
  if (!(error instanceof AppError) || error.details?.operation !== undefined) return error;
  return locatedError(error, `Operation ${index} (${op}): `, { operation: index });
}

/**
 * Runs a validated plan: every operation runs in order through the ordinary Workspace and FileManager over a staged
 * view of the scope, so each one sees the effects of the operations before it and nothing is written while any of
 * them can still fail. The planned state then commits as one guarded batch through the scope's Workspace: one lock,
 * one dry-run diff, rollback on failure and one set of `vault.*` and `metadataCache.*` records. A runner runs one plan.
 */
export class PlanRunner {
  private readonly staged: StagedFiles;
  private readonly trash: string[] = [];
  private planning!: { workspace: Workspace; files: FileManager };

  constructor(private readonly scope: ApplyScope) {
    this.staged = new StagedFiles(scope.workspace.files);
  }

  async run(plan: ApplyPlan) {
    const { workspace, metadata } = this.scope;
    // Link-aware operations need the index; loading it first lets the commit publish metadataCache records.
    if (plan.operations.some(item => item.op === 'move' || item.op === 'delete')) await metadata.load();
    const index = await metadata.fork(this.staged);
    let failure: unknown;
    const observer: CommitObserver = { async committed(batch) { try { await index.update(metadataChanges(batch)); } catch (error) { failure ??= error; } } };
    const planned = new Workspace(this.staged, workspace.codec, silentEvents(), false, workspace.root, observer);
    this.planning = { workspace: planned, files: new FileManager(planned, index, { workspace: this.scope.workspaceScope }) };
    const operations: OperationSummary[] = [];
    for (const [position, item] of plan.operations.entries()) {
      this.staged.operation = position;
      try {
        operations.push({ index: position, ...await this.operation(item) });
        if (failure !== undefined) throw failure;
      } catch (error) { throw located(error, position, item.op); }
    }
    const { batch, previous, trash, operations: owners } = await plannedBatch(this.staged, this.trash);
    if (batch.renames.length + batch.writes.length === 0) return { dryRun: workspace.dryRun, operations, renames: [], changes: [], folders: [] };
    try {
      const result = await workspace.commit(batch, { operation: 'apply', trash, previous });
      return { dryRun: result.dryRun, operations, renames: result.renames, changes: result.changes, folders: result.folders };
    } catch (error) {
      const path = error instanceof AppError ? error.details?.path : undefined;
      const owner = typeof path === 'string' ? owners.get(path) : undefined;
      if (owner === undefined) throw error;
      // The commit's own message names the CLI's --if-match; a plan guards with ifMatch.
      const changed = error instanceof AppError && error.code === 'CONFLICT'
        ? new AppError(error.code, `${String(path)} changed after the plan read it; read it again, rebuild the operation from its current content and use its current revision as ifMatch.`, error.exitCode, error.details)
        : error;
      throw located(changed, owner, plan.operations[owner]!.op);
    }
  }

  /** `ifMatch` names the revision before the plan; the planned operation then runs against the planned revision. */
  private async guard(path: string, ifMatch: string | undefined): Promise<void> {
    if (ifMatch === undefined) return;
    const original = await this.staged.originalRevision(path);
    ensure(original === ifMatch, 'CONFLICT', `${path} changed; read it again and use its current revision as ifMatch.`, revisionConflict(path, ifMatch, original));
  }

  private async operation(item: PlanOperation): Promise<Summary> {
    const { workspace, files } = this.planning;
    switch (item.op) {
      case 'write': {
        const current = await this.staged.current(item.path);
        await this.guard(item.path, item.ifMatch);
        if (current?.origin && item.ifMatch === undefined) throw forgeError('CONFLICT', `Replacing ${item.path} requires ifMatch with the revision it had before the plan.`, revisionConflict(item.path, null, current.origin.revision));
        await workspace.write([{ path: item.path, bytes: contentBytes(item.content, item.encoding), expectedRevision: current?.revision }]);
        return { op: 'write', path: item.path, operation: current ? 'updated' : 'created' };
      }
      case 'edit': {
        const { revision } = await workspace.files.read(item.path);
        await this.guard(item.path, item.ifMatch);
        await workspace.edit(item.path, revision, bytes => editBytes(item.path, bytes, editRequest(item), this.scope.metadata));
        return { op: 'edit', path: item.path };
      }
      case 'frontmatter': {
        const { revision } = await workspace.files.read(item.path);
        await this.guard(item.path, item.ifMatch);
        const result = await files.processFrontMatter(item.path, properties => {
          Object.assign(properties, item.set ?? {});
          for (const key of item.unset ?? []) delete properties[key];
        }, { ifMatch: revision });
        return { op: 'frontmatter', path: item.path, changed: result.changes.length > 0 };
      }
      case 'move': {
        await this.guard(item.from, item.ifMatch);
        const result = await files.move(item.from, item.to, { updateLinks: item.updateLinks });
        return { op: 'move', path: item.from, to: result.to, kind: result.kind, links: result.links };
      }
      case 'delete': {
        await this.guard(item.path, item.ifMatch);
        const result = await files.delete(item.path, { recursive: item.recursive, allowBrokenLinks: item.allowBrokenLinks });
        this.trash.push(result.trashPath!);
        return { op: 'delete', path: item.path, kind: result.kind, trashPath: result.trashPath, brokenLinks: result.brokenLinks };
      }
    }
  }
}
