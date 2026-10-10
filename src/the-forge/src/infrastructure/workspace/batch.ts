import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { forgeError, ensure } from '../../domain/shared/errors.ts';
import { vaultPath, type FileChange, type FileRename, type RemoveRequest, type RenameRequest, type WriteRequest } from '../../domain/documents/file.ts';
import { revisionConflict, snapshotWriteRequests, type RevisionConflict } from '../../domain/documents/write-plan.ts';
import type { BatchResult, FileBatch } from '../../application/workspace/ports.ts';
import { retryTransient } from './retry.ts';

export interface StoredFile { bytes: Buffer; mode: number; revision: string }
export interface FilePlan { write: WriteRequest; target: string; before?: StoredFile }
/** A folder's revision and contents; paths are relative to the folder. `git` reports a nested `.git` entry. */
export interface FolderSnapshot { revision: string; files: Array<{ path: string; revision: string; bytes: number }>; folders: string[]; git: boolean }
type Entry = { kind: 'file'; stored: StoredFile } | { kind: 'folder'; snapshot: FolderSnapshot };
interface RenamePlan { request: RenameRequest; source: string; target: string; entry: Entry; caseOnly: boolean }
interface RemovePlan { request: RemoveRequest; target: string; entry: Entry; temp?: string }

/** The filesystem steps a batch needs; NodeFiles provides them so every step stays observable on one adapter. */
export interface BatchHost {
  readonly root: string;
  revision(bytes: Uint8Array): string;
  resolvePath(path: string, allowFolder?: boolean): Promise<string>;
  stored(path: string): Promise<StoredFile | undefined>;
  assertRevision(path: string, expected: string | undefined): Promise<void>;
  folder(path: string): Promise<FolderSnapshot | undefined>;
  stageAll(plans: readonly FilePlan[], staged: string[]): Promise<void>;
  replace(target: string, bytes: Uint8Array, mode?: number, verify?: () => Promise<void>, staged?: string): Promise<void>;
  syncDirectories(directories: Iterable<string>): Promise<void>;
  warn(message: string): void;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const temporary = (target: string) => join(dirname(target), `.agent-cli-tmp-${randomUUID()}`);
const inside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
const entryRevision = (entry: Entry) => entry.kind === 'file' ? entry.stored.revision : entry.snapshot.revision;

async function exists(target: string): Promise<{ dev: number; ino: number } | undefined> {
  try { return await lstat(target); }
  catch (error) { if (missing(error)) return undefined; throw error; }
}

/**
 * Rejects plans whose steps overlap: writes are unique and never nest, and no rename source, rename destination,
 * removal or write lies inside another one. The only overlap allowed is a write at or inside a rename destination.
 */
function validatePlan(renames: readonly RenameRequest[], writes: readonly WriteRequest[], removes: readonly RemoveRequest[]): void {
  ensure(renames.length + writes.length + removes.length > 0, 'INVALID_PLAN', 'Plan must contain at least one change.');
  ensure(new Set(writes.map(w => w.path)).size === writes.length, 'INVALID_PLAN', 'Plan must contain unique file paths.');
  ensure(!writes.some(a => writes.some(b => b.path.startsWith(a.path + '/'))), 'INVALID_PLAN', 'A generated file cannot also be a directory.');
  for (const rename of renames) ensure(!inside(rename.to, rename.from) && !inside(rename.from, rename.to), 'INVALID_PLAN', `Cannot move ${rename.from} into itself or its parent path ${rename.to}.`);
  type Claim = { path: string; role: 'source' | 'destination' | 'write' };
  const claims: Claim[] = [
    ...renames.flatMap((rename): Claim[] => [{ path: rename.from, role: 'source' }, { path: rename.to, role: 'destination' }]),
    ...removes.map((remove): Claim => ({ path: remove.path, role: 'source' })),
    ...writes.map((write): Claim => ({ path: write.path, role: 'write' })),
  ];
  for (const [index, claim] of claims.entries()) {
    for (const other of claims.slice(index + 1)) {
      if (claim.role === 'write' && other.role === 'write') continue;
      if (!inside(claim.path, other.path) && !inside(other.path, claim.path)) continue;
      const roles = [claim.role, other.role];
      const allowed = roles.includes('write') && roles.includes('destination') && inside((claim.role === 'write' ? claim : other).path, (claim.role === 'write' ? other : claim).path);
      ensure(allowed, 'INVALID_PLAN', `Batch steps overlap at ${claim.path} and ${other.path}.`);
    }
  }
}

/**
 * One guarded batch: validated and checked before anything changes, then applied as renames, writes and
 * removals, with every applied step rolled back in reverse order when a later step fails.
 */
export class Transaction {
  private readonly renames: RenameRequest[];
  private readonly writes: WriteRequest[];
  private readonly removes: RemoveRequest[];
  private readonly createdDirectories: string[] = [];
  private readonly folders: string[] = [];
  private readonly touched = new Set<string>();
  private readonly staged: string[] = [];
  private readonly committedRenames: RenamePlan[] = [];
  private readonly committedWrites: FilePlan[] = [];
  private readonly committedRemoves: RemovePlan[] = [];

  constructor(private readonly host: BatchHost, batch: FileBatch) {
    const valid = (request: unknown, keys: string[]) => request !== null && typeof request === 'object' && keys.every(key => typeof (request as Record<string, unknown>)[key] === 'string');
    ensure(Array.isArray(batch.renames ?? []) && (batch.renames ?? []).every(r => valid(r, ['from', 'to', 'expectedRevision'])), 'INVALID_PLAN', 'Renames need from, to and expectedRevision strings.');
    ensure(Array.isArray(batch.removes ?? []) && (batch.removes ?? []).every(r => valid(r, ['path', 'expectedRevision'])), 'INVALID_PLAN', 'Removals need path and expectedRevision strings.');
    this.renames = (batch.renames ?? []).map(r => ({ from: vaultPath(r.from), to: vaultPath(r.to), expectedRevision: r.expectedRevision }));
    this.writes = snapshotWriteRequests(batch.writes ?? []);
    this.removes = (batch.removes ?? []).map(r => ({ path: vaultPath(r.path), expectedRevision: r.expectedRevision }));
    validatePlan(this.renames, this.writes, this.removes);
  }

  async run(dryRun: boolean): Promise<BatchResult> {
    const conflicts: RevisionConflict[] = [];
    const renames = await this.planRenames(conflicts);
    const writes = await this.planWrites(conflicts);
    const removes = await this.planRemoves(conflicts);
    // The first conflict keeps single-file details flat; multi-step batches also list every conflicting path.
    const [conflict] = conflicts, steps = renames.length + writes.length + removes.length;
    const message = steps === 1 && removes.length === 1 ? `File changed; read again before removing: ${conflict?.path}`
      : `Existing files require their current --if-match revision: ${conflicts.map(item => item.path).join(', ')}`;
    ensure(conflict === undefined, 'CONFLICT', message, conflict && { ...conflict, ...(steps > 1 ? { conflicts } : {}) });
    if (!dryRun) {
      try { await this.apply(renames, writes, removes); }
      catch (error) { await this.rollback(); throw error; }
      await this.finalize();
    }
    return this.result(renames, writes, removes);
  }

  private async entry(path: string): Promise<Entry | undefined> {
    const target = await this.host.resolvePath(path, true);
    const info = await exists(target);
    if (!info) return undefined;
    if ((await lstat(target)).isDirectory()) {
      const snapshot = (await this.host.folder(path))!;
      ensure(!snapshot.git, 'PROTECTED_PATH', `Folder ${path} contains a Git repository; Forge never moves or removes .git.`);
      return { kind: 'folder', snapshot };
    }
    return { kind: 'file', stored: (await this.host.stored(path))! };
  }

  private async planRenames(conflicts: RevisionConflict[]): Promise<RenamePlan[]> {
    const plans: RenamePlan[] = [];
    for (const request of this.renames) {
      const entry = await this.entry(request.from);
      if (!entry) throw forgeError('NOT_FOUND', `File or folder not found: ${request.from}`);
      if (entryRevision(entry) !== request.expectedRevision) conflicts.push(revisionConflict(request.from, request.expectedRevision, entryRevision(entry)));
      const source = await this.host.resolvePath(request.from, true), target = await this.host.resolvePath(request.to, true);
      const caseOnly = await this.caseOnly(request, source, target);
      plans.push({ request, source, target, entry, caseOnly });
    }
    return plans;
  }

  /** A destination that exists is refused, unless it is the source itself under another letter case (case-insensitive filesystems). */
  private async caseOnly(request: RenameRequest, source: string, target: string): Promise<boolean> {
    const existing = await exists(target);
    if (!existing) return false;
    const original = await lstat(source);
    const same = request.from.toLowerCase() === request.to.toLowerCase() && existing.ino === original.ino && existing.dev === original.dev;
    ensure(same, 'DESTINATION_EXISTS', `Destination already exists: ${request.to}`, { path: request.to, from: request.from });
    return true;
  }

  /** The path a write's current content comes from once the batch's renames apply. */
  private origin(path: string): string {
    for (const rename of this.renames) if (inside(path, rename.to)) return rename.from + path.slice(rename.to.length);
    return path;
  }

  private async planWrites(conflicts: RevisionConflict[]): Promise<FilePlan[]> {
    const plans: FilePlan[] = [];
    for (const write of this.writes) {
      const target = await this.host.resolvePath(write.path);
      const before = await this.host.stored(this.origin(write.path));
      if (write.expectedRevision !== before?.revision) conflicts.push(revisionConflict(write.path, write.expectedRevision, before?.revision));
      plans.push({ write, target, before });
    }
    return plans;
  }

  private async planRemoves(conflicts: RevisionConflict[]): Promise<RemovePlan[]> {
    const plans: RemovePlan[] = [];
    for (const request of this.removes) {
      const entry = await this.entry(request.path);
      if (!entry) throw forgeError('NOT_FOUND', `File not found: ${request.path}`);
      const current = entryRevision(entry);
      ensure(request.expectedRevision.length > 0, 'CONFLICT', `Removing a file requires its current --if-match revision: ${request.path}`, revisionConflict(request.path, null, current));
      if (current !== request.expectedRevision) conflicts.push(revisionConflict(request.path, request.expectedRevision, current));
      plans.push({ request, target: await this.host.resolvePath(request.path, true), entry });
    }
    return plans;
  }

  private async makeParents(path: string): Promise<void> {
    let directory = this.host.root;
    const parts = path.split('/');
    for (const [index, part] of parts.slice(0, -1).entries()) {
      directory = join(directory, part);
      try {
        await mkdir(directory);
        this.createdDirectories.push(directory); this.folders.push(parts.slice(0, index + 1).join('/')); this.touched.add(dirname(directory));
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
  }

  /** Immediately before a step: the file or folder still has the revision the batch checked. */
  private async verify(path: string, entry: Entry, expected: string): Promise<void> {
    if (entry.kind === 'file') { await this.host.assertRevision(path, expected); return; }
    const current = (await this.host.folder(path))?.revision;
    ensure(current === expected, 'CONFLICT', `Folder changed; read again before modifying: ${path}`, revisionConflict(path, expected, current));
  }

  private async apply(renames: RenamePlan[], writes: FilePlan[], removes: RemovePlan[]): Promise<void> {
    for (const plan of renames) {
      await this.makeParents(plan.request.to);
      await this.verify(plan.request.from, plan.entry, plan.request.expectedRevision);
      if (!plan.caseOnly) ensure(!await exists(plan.target), 'DESTINATION_EXISTS', `Destination already exists: ${plan.request.to}`, { path: plan.request.to, from: plan.request.from });
      await this.move(plan.source, plan.target, plan.caseOnly);
      this.committedRenames.push(plan);
      this.touched.add(dirname(plan.source)).add(dirname(plan.target));
    }
    for (const plan of writes) await this.makeParents(plan.write.path);
    await this.host.stageAll(writes, this.staged);
    for (const [index, plan] of writes.entries()) {
      await this.host.resolvePath(plan.write.path);
      await this.host.replace(plan.target, plan.write.bytes, plan.before?.mode, () => this.host.assertRevision(plan.write.path, plan.before?.revision), this.staged[index]);
      this.committedWrites.push(plan);
      this.touched.add(dirname(plan.target));
    }
    for (const plan of removes) {
      await this.verify(plan.request.path, plan.entry, plan.request.expectedRevision);
      // Removal parks the entry under a reserved name, so rollback can restore it until the batch is durable.
      const temp = temporary(plan.target);
      await retryTransient(() => rename(plan.target, temp));
      plan.temp = temp;
      this.committedRemoves.push(plan);
      this.touched.add(dirname(plan.target));
    }
    await this.host.syncDirectories(this.touched);
  }

  /** A case-only rename passes through a reserved name, which works whether or not the filesystem ignores case. */
  private async move(source: string, target: string, caseOnly: boolean): Promise<void> {
    if (!caseOnly) { await retryTransient(() => rename(source, target)); return; }
    const temp = temporary(source);
    await retryTransient(() => rename(source, temp));
    try { await retryTransient(() => rename(temp, target)); }
    catch (error) { await retryTransient(() => rename(temp, source)).catch(() => {}); throw error; }
  }

  /** Committed removals become permanent; a cleanup failure leaves a reserved temporary entry and a warning. */
  private async finalize(): Promise<void> {
    for (const plan of this.committedRemoves) {
      try { await retryTransient(() => rm(plan.temp!, { recursive: true, force: true })); }
      catch (error) { this.host.warn(`Removed ${plan.request.path}, but could not delete its temporary entry ${plan.temp}: ${String(error)}`); }
    }
    if (this.committedRemoves.length === 0) return;
    try { await this.host.syncDirectories(this.committedRemoves.map(plan => dirname(plan.target))); }
    catch (error) { this.host.warn(`Removed files, but syncing their folders failed: ${String(error)}`); }
  }

  private async rollback(): Promise<void> {
    // Renamed temporaries no longer exist; the rest must go before directories are removed.
    for (const temp of this.staged) if (temp) await retryTransient(() => rm(temp, { force: true })).catch(() => {});
    const failures: string[] = [];
    for (const plan of this.committedRemoves.reverse()) {
      try { ensure(!await exists(plan.target), 'ROLLBACK_FAILED', plan.target); await retryTransient(() => rename(plan.temp!, plan.target)); }
      catch { failures.push(plan.target); }
    }
    for (const entry of this.committedWrites.reverse()) {
      try {
        // Never silently roll back over a newer edit from an external writer.
        const verify = () => this.host.assertRevision(entry.write.path, this.host.revision(entry.write.bytes));
        if (entry.before) await this.host.replace(entry.target, entry.before.bytes, entry.before.mode, verify);
        else { await verify(); await retryTransient(() => rm(entry.target)); }
      } catch { failures.push(entry.target); }
    }
    for (const plan of this.committedRenames.reverse()) {
      try {
        if (plan.entry.kind === 'file') await this.host.assertRevision(plan.request.to, plan.entry.stored.revision);
        if (!plan.caseOnly) ensure(!await exists(plan.source), 'ROLLBACK_FAILED', plan.source);
        await this.move(plan.target, plan.source, plan.caseOnly);
      } catch { failures.push(plan.target); }
    }
    for (const directory of this.createdDirectories.reverse()) {
      try { await retryTransient(() => rmdir(directory)); this.touched.delete(directory); }
      catch { /* A directory still holding external files remains in place. */ }
    }
    for (const directory of this.touched) {
      try { await this.host.syncDirectories([directory]); }
      catch { failures.push(directory); }
    }
    if (failures.length) throw forgeError('ROLLBACK_FAILED', `Inspect these files before retrying: ${failures.join(', ')}`);
  }

  private result(renames: RenamePlan[], writes: FilePlan[], removes: RemovePlan[]): BatchResult {
    const moved: FileRename[] = renames.flatMap(({ request: { from, to }, entry }): FileRename[] => {
      if (entry.kind === 'file') return [{ from, to, kind: 'file', revision: entry.stored.revision, bytes: entry.stored.bytes.length }];
      const descendants: FileRename[] = [
        ...entry.snapshot.folders.map((path): FileRename => ({ from: `${from}/${path}`, to: `${to}/${path}`, kind: 'folder' })),
        ...entry.snapshot.files.map((file): FileRename => ({ from: `${from}/${file.path}`, to: `${to}/${file.path}`, kind: 'file', revision: file.revision, bytes: file.bytes })),
      ].sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
      return [{ from, to, kind: 'folder' }, ...descendants];
    });
    const written = writes.map(({ write, before }): FileChange => ({ path: write.path, revision: this.host.revision(write.bytes), operation: before === undefined ? 'created' : 'updated', bytes: write.bytes.length }));
    const removed = removes.flatMap(({ request: { path }, entry }): FileChange[] => entry.kind === 'file'
      ? [{ path, revision: entry.stored.revision, operation: 'deleted', bytes: entry.stored.bytes.length }]
      : entry.snapshot.files.map(file => ({ path: `${path}/${file.path}`, revision: file.revision, operation: 'deleted', bytes: file.bytes })));
    const removedFolders = removes.flatMap(({ request: { path }, entry }) => entry.kind === 'file' ? []
      : [...entry.snapshot.folders.map(folder => `${path}/${folder}`).sort().reverse(), path]);
    return { renames: moved, changes: [...written, ...removed], folders: this.folders, removedFolders };
  }
}
