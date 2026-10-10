import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, mkdir, realpath, rename, rm, rmdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { forgeError, errorMessage, ensure } from '../../domain/shared/errors.ts';
import { vaultPath, type WriteRequest, type FileChange } from '../../domain/documents/file.ts';
import { revisionConflict, snapshotWriteRequests, type RevisionConflict } from '../../domain/documents/write-plan.ts';
import type { FileRepository, WriteBatchResult } from '../../application/workspace/ports.ts';
import { syncDirectory } from './durable.ts';
import { acquireLock, lockName, releaseLock, type LockOwner, type LockRelease } from './lock.ts';
import { retryTransient } from './retry.ts';

export const revisionOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
interface StoredFile { bytes: Buffer; mode: number; revision: string }
interface FilePlan { write: WriteRequest; target: string; before?: StoredFile }
/** Concurrent staging lets the filesystem group fsyncs while bounding open handles. */
const stagingConcurrency = 8;

export class NodeFiles implements FileRepository {
  private constructor(readonly root: string, private readonly warn: (message: string) => void, private readonly owner: () => LockOwner) {}
  /** `owner` names the invocation recorded in the writer lock; composition code supplies it. */
  static async at(root: string, warn: (message: string) => void = () => {}, owner: () => LockOwner = () => ({})): Promise<NodeFiles> {
    return new NodeFiles(await realpath(resolve(root)), warn, owner);
  }
  async resolvePath(path: string): Promise<string> {
    const parts = vaultPath(path).split('/');
    let current = this.root;
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      try {
        const info = await lstat(current);
        ensure(!info.isSymbolicLink(), 'UNSAFE_PATH', `Symlinks are not supported: ${path}`);
        ensure(index === parts.length - 1 ? info.isFile() : info.isDirectory(), 'INVALID_PATH', `Not a regular file path: ${path}`);
      } catch (error) { if (!missing(error)) throw error; }
    }
    return current;
  }
  async read(path: string) {
    try {
      const bytes = await readFile(await this.resolvePath(path));
      return { path, bytes, revision: revisionOf(bytes) };
    } catch (error) {
      if (missing(error)) throw forgeError('NOT_FOUND', `File not found: ${path}`);
      throw error;
    }
  }
  async list(): Promise<string[]> {
    const result: string[] = [];
    const walk = async (directory: string, prefix: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (['.git', 'node_modules', lockName].includes(entry.name) || entry.name.startsWith('.agent-cli-tmp-')) continue;
        const path = prefix + entry.name;
        if (entry.isDirectory()) await walk(join(directory, entry.name), path + '/');
        else if (entry.isFile()) result.push(path);
      }
    };
    await walk(this.root, ''); return result.sort();
  }
  private async stored(path: string): Promise<StoredFile | undefined> {
    const target = await this.resolvePath(path);
    try {
      const mode = (await lstat(target)).mode & 0o7777;
      const bytes = await readFile(target);
      return { bytes, mode, revision: revisionOf(bytes) };
    } catch (error) { if (!missing(error)) throw error; return undefined; }
  }
  private async assertRevision(path: string, expected: string | undefined): Promise<void> {
    const current = (await this.stored(path))?.revision;
    ensure(current === expected, 'CONFLICT', `File changed; read again before modifying: ${path}`, revisionConflict(path, expected, current));
  }
  async remove(path: string, expectedRevision: string, dryRun: boolean): Promise<FileChange> {
    path = vaultPath(path);
    const guarded = typeof expectedRevision === 'string' && expectedRevision.length > 0;
    const lock = join(this.root, lockName);
    let token: string | undefined;
    try {
      if (!dryRun) token = await acquireLock(lock, this.owner);
      const target = await this.resolvePath(path);
      const before = await this.stored(path);
      if (before === undefined) throw forgeError('NOT_FOUND', `File not found: ${path}`);
      ensure(guarded, 'CONFLICT', `Removing a file requires its current --if-match revision: ${path}`, revisionConflict(path, null, before.revision));
      ensure(before.revision === expectedRevision, 'CONFLICT', `File changed; read again before removing: ${path}`, revisionConflict(path, expectedRevision, before.revision));
      if (!dryRun) {
        await this.assertRevision(path, expectedRevision);
        // unlink cannot remove a directory, even if an external writer replaces the file.
        await retryTransient(() => unlink(target));
        await this.syncDirectories([dirname(target)]);
      }
      return { path, revision: before.revision, operation: 'deleted', bytes: before.bytes.length };
    } finally { if (token !== undefined) await this.cleanupLock(lock, token); }
  }
  async writeBatch(writes: readonly WriteRequest[], dryRun: boolean): Promise<WriteBatchResult> {
    const requests = snapshotWriteRequests(writes);
    ensure(requests.length > 0 && new Set(requests.map(w => w.path)).size === requests.length, 'INVALID_PLAN', 'Plan must contain unique file paths.');
    ensure(!requests.some(a => requests.some(b => b.path.startsWith(a.path + '/'))), 'INVALID_PLAN', 'A generated file cannot also be a directory.');
    const lock = join(this.root, lockName);
    let token: string | undefined;
    const createdDirectories: string[] = [];
    // Vault paths of the created directories, parent before child, for post-commit folder events.
    const folders: string[] = [];
    const committed: FilePlan[] = [];
    const staged: string[] = [];
    // Each changed directory entry is fsynced once, after all renames and before events.
    const touched = new Set<string>();
    try {
      if (!dryRun) token = await acquireLock(lock, this.owner);
      const plans: FilePlan[] = [];
      const conflicts: RevisionConflict[] = [];
      for (const write of requests) {
        const target = await this.resolvePath(write.path);
        const before = await this.stored(write.path);
        if (write.expectedRevision !== before?.revision) conflicts.push(revisionConflict(write.path, write.expectedRevision, before?.revision));
        plans.push({ write, target, before });
      }
      // The first conflict keeps single-file details flat; multi-file batches also list every conflicting path.
      const [conflict] = conflicts;
      ensure(conflict === undefined, 'CONFLICT', `Existing files require their current --if-match revision: ${conflicts.map(item => item.path).join(', ')}`,
        conflict && { ...conflict, ...(requests.length > 1 ? { conflicts } : {}) });
      if (!dryRun) {
        for (const plan of plans) {
          let directory = this.root;
          const parts = plan.write.path.split('/');
          for (const [index, part] of parts.slice(0, -1).entries()) {
            directory = join(directory, part);
            try { await mkdir(directory); createdDirectories.push(directory); folders.push(parts.slice(0, index + 1).join('/')); touched.add(dirname(directory)); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
          }
        }
        await this.stageAll(plans, staged);
        for (const [index, plan] of plans.entries()) {
          await this.resolvePath(plan.write.path);
          await this.replace(plan.target, plan.write.bytes, plan.before?.mode, () => this.assertRevision(plan.write.path, plan.before?.revision), staged[index]);
          committed.push(plan);
          touched.add(dirname(plan.target));
        }
        await this.syncDirectories(touched);
      }
      const changes = plans.map(({ write, before }): FileChange => ({ path: write.path, revision: revisionOf(write.bytes), operation: before === undefined ? 'created' : 'updated', bytes: write.bytes.length }));
      return { changes, folders };
    } catch (error) {
      // Renamed temporaries no longer exist; the rest must go before directories are removed.
      for (const temp of staged) if (temp) await retryTransient(() => rm(temp, { force: true })).catch(() => {});
      const failures: string[] = [];
      for (const entry of committed.reverse()) {
        try {
          // Never silently roll back over a newer edit from an external writer.
          const verify = () => this.assertRevision(entry.write.path, revisionOf(entry.write.bytes));
          if (entry.before) await this.replace(entry.target, entry.before.bytes, entry.before.mode, verify);
          else { await verify(); await retryTransient(() => rm(entry.target)); }
        } catch { failures.push(entry.target); }
      }
      for (const directory of createdDirectories.reverse()) {
        try { await retryTransient(() => rmdir(directory)); touched.delete(directory); }
        catch { /* A directory still holding external files remains in place. */ }
      }
      for (const directory of touched) {
        try { await syncDirectory(directory); }
        catch { failures.push(directory); }
      }
      if (failures.length) throw forgeError('ROLLBACK_FAILED', `Inspect these files before retrying: ${failures.join(', ')}`);
      throw error;
    } finally { if (token !== undefined) await this.cleanupLock(lock, token); }
  }
  private async cleanupLock(lock: string, token: string): Promise<void> {
    let warning: string | undefined;
    try {
      const outcome = await this.releaseLock(lock, token);
      if (outcome === 'foreign') warning = `Left ${lockName} in place: it no longer carries this writer's token, so another writer may hold it.`;
      else if (outcome === 'missing') warning = `${lockName} was removed by someone else while this writer held it; inspect concurrent changes.`;
    } catch (error) {
      // A cleanup failure cannot erase committed changes or the primary error.
      warning = `Could not remove ${lockName}; inspect the lock before retrying: ${errorMessage(error)}`;
    }
    if (warning === undefined) return;
    try { this.warn(warning); }
    catch { /* Diagnostics must not change the write outcome. */ }
  }
  private async releaseLock(lock: string, token: string): Promise<LockRelease> { return releaseLock(lock, token); }
  private async syncDirectories(directories: Iterable<string>): Promise<void> {
    for (const directory of new Set(directories)) await syncDirectory(directory);
  }
  /** Stage every plan, waiting for all workers so that no temporary file escapes cleanup. */
  private async stageAll(plans: readonly FilePlan[], staged: string[]): Promise<void> {
    let next = 0;
    const failures: unknown[] = [];
    const worker = async () => {
      while (next < plans.length && failures.length === 0) {
        const index = next++, plan = plans[index]!;
        try { staged[index] = await this.stage(plan.target, plan.write.bytes, plan.before?.mode); }
        catch (error) { failures.push(error); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(stagingConcurrency, plans.length) }, worker));
    if (failures.length) throw failures[0];
  }
  /** Write a same-directory temporary file whose data is durable before any rename publishes it. */
  private async stage(target: string, bytes: Uint8Array, mode?: number): Promise<string> {
    const temp = join(resolve(target, '..'), `.agent-cli-tmp-${randomUUID()}`);
    const handle = await open(temp, 'wx', mode ?? 0o666);
    try {
      try {
        await handle.writeFile(bytes);
        // Creation modes are filtered by umask; existing files must retain their exact mode.
        if (mode !== undefined) await handle.chmod(mode);
        await handle.sync();
      } finally { await handle.close(); }
    } catch (error) {
      await retryTransient(() => rm(temp, { force: true })).catch(() => {});
      throw error;
    }
    return temp;
  }
  /** Publish `staged` (or freshly staged bytes) over the target; the caller fsyncs the directory entry. */
  private async replace(target: string, bytes: Uint8Array, mode?: number, verify?: () => Promise<void>, staged?: string): Promise<void> {
    const temp = staged ?? await this.stage(target, bytes, mode);
    let renamed = false;
    try {
      await verify?.();
      await retryTransient(() => rename(temp, target));
      renamed = true;
    } finally {
      // Cleanup errors must not turn a successful rename into an untracked commit.
      if (!renamed) await retryTransient(() => rm(temp, { force: true })).catch(() => {});
    }
  }
}
