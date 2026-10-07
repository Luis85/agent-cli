import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, mkdir, realpath, rename, rm, rmdir, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { errorMessage, AppError, ensure } from '../../domain/shared/errors.ts';
import { vaultPath, type WriteRequest, type FileChange } from '../../domain/documents/file.ts';
import { snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import type { FileRepository } from '../../application/workspace/ports.ts';

export const revisionOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
interface StoredFile { bytes: Buffer; mode: number; revision: string }

export class NodeFiles implements FileRepository {
  private constructor(readonly root: string, private readonly warn: (message: string) => void) {}
  static async at(root: string, warn: (message: string) => void = () => {}): Promise<NodeFiles> { return new NodeFiles(await realpath(resolve(root)), warn); }
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
      if (missing(error)) throw new AppError('NOT_FOUND', `File not found: ${path}`, 3);
      throw error;
    }
  }
  async list(): Promise<string[]> {
    const result: string[] = [];
    const walk = async (directory: string, prefix: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (['.git', 'node_modules', '.agent-cli.lock'].includes(entry.name) || entry.name.startsWith('.agent-cli-tmp-')) continue;
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
    ensure((await this.stored(path))?.revision === expected, 'CONFLICT', `File changed; read again before modifying: ${path}`);
  }
  async remove(path: string, expectedRevision: string, dryRun: boolean): Promise<FileChange> {
    path = vaultPath(path);
    ensure(typeof expectedRevision === 'string' && expectedRevision.length > 0, 'CONFLICT', `Removing a file requires its current --if-match revision: ${path}`);
    const lock = join(this.root, '.agent-cli.lock');
    let locked = false;
    try {
      if (!dryRun) {
        try { const handle = await open(lock, 'wx'); locked = true; await handle.close(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw this.busy(); throw error; }
      }
      const target = await this.resolvePath(path);
      const before = await this.stored(path);
      if (before === undefined) throw new AppError('NOT_FOUND', `File not found: ${path}`, 3);
      ensure(before.revision === expectedRevision, 'CONFLICT', `File changed; read again before removing: ${path}`);
      if (!dryRun) {
        await this.assertRevision(path, expectedRevision);
        // unlink cannot remove a directory, even if an external writer replaces the file.
        await unlink(target);
      }
      return { path, revision: before.revision, operation: 'deleted', bytes: before.bytes.length };
    } finally { if (locked) await this.cleanupLock(lock); }
  }
  async writeBatch(writes: readonly WriteRequest[], dryRun: boolean): Promise<FileChange[]> {
    const requests = snapshotWriteRequests(writes);
    ensure(requests.length > 0 && new Set(requests.map(w => w.path)).size === requests.length, 'INVALID_PLAN', 'Plan must contain unique file paths.');
    ensure(!requests.some(a => requests.some(b => b.path.startsWith(a.path + '/'))), 'INVALID_PLAN', 'A generated file cannot also be a directory.');
    const lock = join(this.root, '.agent-cli.lock');
    let locked = false;
    const createdDirectories: string[] = [];
    const committed: Array<{ write: WriteRequest; target: string; before?: StoredFile }> = [];
    try {
      if (!dryRun) {
        try { const handle = await open(lock, 'wx'); locked = true; await handle.close(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw this.busy(); throw error; }
      }
      const plans = [];
      for (const write of requests) {
        const target = await this.resolvePath(write.path);
        const before = await this.stored(write.path);
        ensure(before === undefined ? write.expectedRevision === undefined : write.expectedRevision === before.revision, 'CONFLICT', `Existing files require their current --if-match revision: ${write.path}`);
        plans.push({ write, target, before });
      }
      if (!dryRun) for (const plan of plans) {
        const parts = plan.write.path.split('/').slice(0, -1);
        let directory = this.root;
        for (const part of parts) {
          directory = join(directory, part);
          try { await mkdir(directory); createdDirectories.push(directory); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        await this.resolvePath(plan.write.path);
        await this.replace(plan.target, plan.write.bytes, plan.before?.mode, () => this.assertRevision(plan.write.path, plan.before?.revision));
        committed.push(plan);
      }
      return plans.map(({ write, before }) => ({ path: write.path, revision: revisionOf(write.bytes), operation: before === undefined ? 'created' : 'updated', bytes: write.bytes.length }));
    } catch (error) {
      const failures: string[] = [];
      for (const entry of committed.reverse()) {
        try {
          // Never silently roll back over a newer edit from an external writer.
          const verify = () => this.assertRevision(entry.write.path, revisionOf(entry.write.bytes));
          if (entry.before) await this.replace(entry.target, entry.before.bytes, entry.before.mode, verify);
          else { await verify(); await rm(entry.target); }
        } catch { failures.push(entry.target); }
      }
      for (const directory of createdDirectories.reverse()) await rmdir(directory).catch(() => {});
      if (failures.length) throw new AppError('ROLLBACK_FAILED', `Inspect these files before retrying: ${failures.join(', ')}`);
      throw error;
    } finally { if (locked) await this.cleanupLock(lock); }
  }
  private busy(): AppError {
    return new AppError('WORKSPACE_BUSY', 'Workspace lock .agent-cli.lock exists. Wait for the active writer. If a previous process was interrupted, inspect its changes and confirm no writer is running before removing the lock.', 4);
  }
  private async cleanupLock(lock: string): Promise<void> {
    try { await this.releaseLock(lock); }
    catch (error) {
      // A cleanup failure cannot erase committed changes or the primary error.
      try { this.warn(`Could not remove .agent-cli.lock; inspect the lock before retrying: ${errorMessage(error)}`); }
      catch { /* Diagnostics must not change the write outcome. */ }
    }
  }
  private async releaseLock(lock: string): Promise<void> { await rm(lock, { force: true }); }
  private async replace(target: string, bytes: Uint8Array, mode?: number, verify?: () => Promise<void>): Promise<void> {
    const temp = join(resolve(target, '..'), `.agent-cli-tmp-${randomUUID()}`);
    let created = false;
    let renamed = false;
    try {
      const handle = await open(temp, 'wx', mode ?? 0o666);
      created = true;
      try {
        await handle.writeFile(bytes);
        // Creation modes are filtered by umask; existing files must retain their exact mode.
        if (mode !== undefined) await handle.chmod(mode);
      } finally { await handle.close(); }
      await verify?.();
      await rename(temp, target);
      renamed = true;
    } finally {
      // Cleanup errors must not turn a successful rename into an untracked commit.
      if (created && !renamed) await rm(temp, { force: true }).catch(() => {});
    }
  }
}
