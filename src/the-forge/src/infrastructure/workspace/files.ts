import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath, rename, rm, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { forgeError, errorMessage, ensure } from '../../domain/shared/errors.ts';
import { vaultPath, type WriteRequest, type FileChange, type FileStat } from '../../domain/documents/file.ts';
import { revisionConflict, snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import type { BatchResult, FileBatch, FileRepository, WriteBatchResult } from '../../application/workspace/ports.ts';
import { Transaction, type BatchHost, type FilePlan, type FolderSnapshot, type StoredFile } from './batch.ts';
import { syncDirectory } from './durable.ts';
import { acquireLock, lockName, releaseLock, type LockOwner, type LockRelease } from './lock.ts';
import { retryTransient } from './retry.ts';

export const revisionOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
/** Concurrent staging lets the filesystem group fsyncs while bounding open handles. */
const stagingConcurrency = 8;

export class NodeFiles implements FileRepository, BatchHost {
  private constructor(readonly root: string, private readonly warning: (message: string) => void, private readonly owner: () => LockOwner) {}
  /** `owner` names the invocation recorded in the writer lock; composition code supplies it. */
  static async at(root: string, warn: (message: string) => void = () => {}, owner: () => LockOwner = () => ({})): Promise<NodeFiles> {
    return new NodeFiles(await realpath(resolve(root)), warn, owner);
  }
  /** The absolute path, refusing symlinks and parents that are not folders; the final segment may be a folder only when `allowFolder` is set. */
  async resolvePath(path: string, allowFolder = false): Promise<string> {
    const parts = vaultPath(path).split('/');
    let current = this.root;
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      try {
        const info = await lstat(current);
        ensure(!info.isSymbolicLink(), 'UNSAFE_PATH', `Symlinks are not supported: ${path}`);
        ensure(index === parts.length - 1 ? info.isFile() || (allowFolder && info.isDirectory()) : info.isDirectory(), 'INVALID_PATH', `Not a regular file path: ${path}`);
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
  /** @internal */
  async stored(path: string): Promise<StoredFile | undefined> {
    const target = await this.resolvePath(path);
    try {
      const mode = (await lstat(target)).mode & 0o7777;
      const bytes = await readFile(target);
      return { bytes, mode, revision: revisionOf(bytes) };
    } catch (error) { if (!missing(error)) throw error; return undefined; }
  }
  /** @internal */
  async assertRevision(path: string, expected: string | undefined): Promise<void> {
    const current = (await this.stored(path))?.revision;
    ensure(current === expected, 'CONFLICT', `File changed; read again before modifying: ${path}`, revisionConflict(path, expected, current));
  }
  async remove(path: string, expectedRevision: string, dryRun: boolean): Promise<FileChange> {
    // Only files: a folder fails here, because removing one recursively is a deliberate commit.
    await this.resolvePath(path);
    const { changes } = await this.commit({ removes: [{ path, expectedRevision: typeof expectedRevision === 'string' ? expectedRevision : '' }] }, dryRun);
    return changes[0]!;
  }
  async writeBatch(writes: readonly WriteRequest[], dryRun: boolean): Promise<WriteBatchResult> {
    const requests = snapshotWriteRequests(writes);
    ensure(requests.length > 0, 'INVALID_PLAN', 'Plan must contain unique file paths.');
    const { changes, folders } = await this.commit({ writes: requests }, dryRun);
    return { changes, folders };
  }
  async commit(batch: FileBatch, dryRun: boolean): Promise<BatchResult> {
    ensure(batch !== null && typeof batch === 'object', 'INVALID_PLAN', 'A batch must be an object.');
    const transaction = new Transaction(this, batch);
    const lock = join(this.root, lockName);
    let token: string | undefined;
    try {
      if (!dryRun) token = await acquireLock(lock, this.owner);
      return await transaction.run(dryRun);
    } finally { if (token !== undefined) await this.cleanupLock(lock, token); }
  }
  async stat(path: string): Promise<FileStat> {
    path = vaultPath(path);
    const target = await this.resolvePath(path, true);
    let info;
    try { info = await lstat(target); }
    catch (error) { if (missing(error)) throw forgeError('NOT_FOUND', `File or folder not found: ${path}`); throw error; }
    if (info.isDirectory()) {
      const { revision, files, folders } = (await this.folder(path))!;
      return { path, kind: 'folder', revision, files: files.map(file => file.path), folders };
    }
    const stored = (await this.stored(path))!;
    return { path, kind: 'file', revision: stored.revision, bytes: stored.bytes.length };
  }
  /** @internal Batch step: the folder's revision and contents, skipping Git, node_modules, symlinks and Forge's internal files. */
  async folder(path: string): Promise<FolderSnapshot | undefined> {
    const files: FolderSnapshot['files'] = [], folders: string[] = [];
    let git = false;
    const walk = async (directory: string, prefix: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === '.git') git = true;
        if (['.git', 'node_modules', lockName].includes(entry.name) || entry.name.startsWith('.agent-cli-tmp-')) continue;
        const relative = prefix + entry.name;
        if (entry.isDirectory()) { folders.push(relative); await walk(join(directory, entry.name), relative + '/'); }
        else if (entry.isFile()) {
          const bytes = await readFile(join(directory, entry.name));
          files.push({ path: relative, revision: revisionOf(bytes), bytes: bytes.length });
        }
      }
    };
    try { await walk(await this.resolvePath(path, true), ''); }
    catch (error) { if (missing(error)) return undefined; throw error; }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const digest = createHash('sha256');
    for (const file of files) digest.update(`${file.path}\0${file.revision}\n`);
    return { revision: digest.digest('hex'), files, folders: folders.sort(), git };
  }
  /** @internal */
  revision(bytes: Uint8Array): string { return revisionOf(bytes); }
  /** @internal */
  warn(message: string): void {
    try { this.warning(message); }
    catch { /* Diagnostics must not change the write outcome. */ }
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
    if (warning !== undefined) this.warn(warning);
  }
  private async releaseLock(lock: string, token: string): Promise<LockRelease> { return releaseLock(lock, token); }
  /** @internal */
  async syncDirectories(directories: Iterable<string>): Promise<void> {
    for (const directory of new Set(directories)) await syncDirectory(directory);
  }
  /** Stage every plan, waiting for all workers so that no temporary file escapes cleanup. */
  /** @internal */
  async stageAll(plans: readonly FilePlan[], staged: string[]): Promise<void> {
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
  /** @internal */
  async replace(target: string, bytes: Uint8Array, mode?: number, verify?: () => Promise<void>, staged?: string): Promise<void> {
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
