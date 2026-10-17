import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, readlink, realpath, rename, rm, open } from 'node:fs/promises';
import { lstatSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { forgeError, errorMessage, ensure } from '../../domain/shared/errors.ts';
import { kernelMessage, type KernelMessage } from '../../domain/shared/kernel-messages.ts';
import { aliasesName, reservedPathSegment, temporaryPrefix, vaultPath, writerLockName, type WriteRequest, type FileChange, type FileStat } from '../../domain/documents/file.ts';
import type { FileStamp } from '../../domain/metadata/snapshot.ts';
import { revisionConflict, snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import type { BatchResult, FileBatch, FileRepository, RecoveredLock, WriteBatchResult } from '../../application/workspace/ports.ts';
import { Transaction, type BatchHost, type FilePlan, type FolderSnapshot, type SpecialEntry, type StoredFile } from './batch.ts';
import { syncDirectory } from './durable.ts';
import { acquireLockWithin, recoveredLockMessage, releaseLock, type LockOwner, type LockRelease } from './lock.ts';
import { retryTransient } from './retry.ts';

export const revisionOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
/** Errors that make a vault path unusable on this filesystem: a name that is too long, a file used as a folder, a symlink loop. */
const unusablePath: ReadonlySet<string> = new Set(['ENAMETOOLONG', 'ENOTDIR', 'ELOOP']);
/** A filesystem error for `path` as a coded failure; the message names the vault path, never the absolute one. */
function pathFailure(error: unknown, path: string): unknown {
  const code = (error as NodeJS.ErrnoException).code ?? '';
  return unusablePath.has(code) ? forgeError('INVALID_PATH', `Path cannot be used on this filesystem (${code}): ${path}`, { path, reason: code }) : error;
}
/** A folder entry's name, refusing names that are not valid UTF-8: they cannot be read back by the decoded name. */
function entryName(name: Buffer, folder: string): string {
  const decoded = name.toString('utf8');
  ensure(Buffer.from(decoded, 'utf8').equals(name), 'INVALID_PATH', `Folder ${folder} holds an entry whose name is not valid UTF-8: ${decoded}`, { path: folder, entry: decoded });
  return decoded;
}
/** Commits of this process per writer lock: each waits for the previous one, so one process never competes with itself. */
const commitQueues = new Map<string, Promise<unknown>>();
function queued<T>(lock: string, task: () => Promise<T>): Promise<T> {
  const run = (commitQueues.get(lock) ?? Promise.resolve()).then(task);
  const tail = run.catch(() => {});
  commitQueues.set(lock, tail);
  void tail.then(() => { if (commitQueues.get(lock) === tail) commitQueues.delete(lock); });
  return run;
}
/**
 * The workspace root's folder of derived caches (the metadata snapshots). Like the writer lock it is Forge's own
 * state, not workspace content: listings leave it out, while direct reads still reach it.
 */
export const cacheFolder = '.forge/cache';
/** Entries `list()` never reports or enters: Git, dependencies, Forge's own lock and temporary files and the root cache folder. */
const unlisted = (name: string, path: string) => reservedPathSegment(name) !== undefined || name.toLowerCase() === 'node_modules' || path.toLowerCase() === cacheFolder;
/** Concurrent staging lets the filesystem group fsyncs while bounding open handles. */
const stagingConcurrency = 8;

export class NodeFiles implements FileRepository, BatchHost {
  private constructor(readonly root: string, private readonly warning: (message: KernelMessage) => void, private readonly owner: () => LockOwner, private readonly wait: () => number) {}
  /**
   * `warn` receives coded diagnostics, such as a stale writer lock a commit removed or a lock it could not release;
   * `owner` names the invocation recorded in the writer lock and `wait` how many milliseconds a commit may wait for
   * another process's writer lock (`--wait`). Composition code supplies them.
   */
  static async at(root: string, warn: (message: KernelMessage) => void = () => {}, owner: () => LockOwner = () => ({}), wait: () => number = () => 0): Promise<NodeFiles> {
    return new NodeFiles(await realpath(resolve(root)), warn, owner, wait);
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
      } catch (error) { if (!missing(error)) throw pathFailure(error, path); }
    }
    return current;
  }
  async read(path: string) {
    try {
      const bytes = await readFile(await this.resolvePath(path));
      return { path, bytes, revision: revisionOf(bytes) };
    } catch (error) {
      if (missing(error)) throw forgeError('NOT_FOUND', `File not found: ${path}`, { path });
      throw pathFailure(error, path);
    }
  }
  async list(): Promise<string[]> {
    const result: string[] = [];
    const walk = async (directory: string, prefix: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (unlisted(entry.name, prefix + entry.name)) continue;
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
    } catch (error) { if (!missing(error)) throw pathFailure(error, path); return undefined; }
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
  /**
   * Runs a batch under the writer lock. Commits of this process queue for the lock; another process's lock is waited
   * for up to the `wait` budget while it stays retryable, then fails with WORKSPACE_BUSY.
   */
  async commit(batch: FileBatch, dryRun: boolean): Promise<BatchResult> {
    ensure(batch !== null && typeof batch === 'object', 'INVALID_PLAN', 'A batch must be an object.');
    const transaction = new Transaction(this, batch);
    if (dryRun) return transaction.run(true);
    const lock = join(this.root, writerLockName);
    return queued(lock, async () => {
      const token = await acquireLockWithin(this.wait(), lock, this.owner, writerLockName, recovered => this.report(recovered));
      try { return await transaction.run(false); }
      finally { await this.cleanupLock(lock, token); }
    });
  }
  async stat(path: string): Promise<FileStat> {
    path = vaultPath(path);
    const target = await this.resolvePath(path, true);
    let info;
    try { info = await lstat(target); }
    catch (error) { if (missing(error)) throw forgeError('NOT_FOUND', `File or folder not found: ${path}`, { path }); throw pathFailure(error, path); }
    // An entry that disappears after lstat was removed concurrently, as if it had never been found.
    const gone = () => forgeError('NOT_FOUND', `File or folder not found: ${path}`, { path });
    if (info.isDirectory()) {
      const snapshot = await this.folder(path);
      if (!snapshot) throw gone();
      return { path, kind: 'folder', revision: snapshot.revision, files: snapshot.files.map(file => file.path), folders: snapshot.folders };
    }
    const stored = await this.stored(path);
    if (!stored) throw gone();
    return { path, kind: 'file', revision: stored.revision, bytes: stored.bytes.length };
  }
  /**
   * @internal Batch step: the folder's revision and contents. The revision covers every file's path and revision,
   * every subfolder (empty ones too) and each special entry by path and kind: symlinks with their target,
   * `node_modules` folders without reading them, and other special files. Git and Forge's internal files are skipped;
   * writer locks of nested roots are listed in `locks`.
   * Undefined when the folder is missing; an entry that vanishes during the walk is a CONFLICT and an entry name that
   * is not valid UTF-8 is INVALID_PATH.
   */
  async folder(path: string): Promise<FolderSnapshot | undefined> {
    const files: FolderSnapshot['files'] = [], folders: string[] = [], special: SpecialEntry[] = [], locks: string[] = [];
    let git = false, entered = false;
    const walk = async (directory: string, prefix: string) => {
      const entries = await readdir(directory, { withFileTypes: true, encoding: 'buffer' });
      entered = true;
      for (const entry of entries) {
        const name = entryName(entry.name, `${path}/${prefix}`.replace(/\/$/, ''));
        const reserved = reservedPathSegment(name);
        if (reserved === 'git') { git = true; continue; }
        if (reserved === 'internal') { if (aliasesName(name, writerLockName)) locks.push(prefix + name); continue; }
        const relative = prefix + name, absolute = join(directory, name);
        if (entry.isSymbolicLink()) special.push({ path: relative, kind: 'symlink', target: await readlink(absolute) });
        else if (entry.isDirectory() && name.toLowerCase() === 'node_modules') special.push({ path: relative, kind: 'node_modules' });
        else if (entry.isDirectory()) { folders.push(relative); await walk(absolute, relative + '/'); }
        else if (entry.isFile()) {
          const bytes = await readFile(absolute);
          files.push({ path: relative, revision: revisionOf(bytes), bytes: bytes.length });
        } else special.push({ path: relative, kind: 'other' });
      }
    };
    try { await walk(await this.resolvePath(path, true), ''); }
    catch (error) {
      if (missing(error) && !entered) return undefined;
      if (!missing(error) && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error;
      throw forgeError('CONFLICT', `Folder changed while Forge read it; read it again: ${path}`, { path });
    }
    const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    files.sort((a, b) => order(a.path, b.path)); folders.sort(order); special.sort((a, b) => order(a.path, b.path));
    const digest = createHash('sha256');
    for (const file of files) digest.update(`${file.path}\0${file.revision}\n`);
    for (const folder of folders) digest.update(`${folder}/\0folder\n`);
    for (const entry of special) digest.update(`${entry.path}\0${entry.kind}${entry.target === undefined ? '' : `\0${entry.target}`}\n`);
    return { revision: digest.digest('hex'), files, folders, special, git, locks: locks.sort(order) };
  }
  /** @internal */
  revision(bytes: Uint8Array): string { return revisionOf(bytes); }
  /** @internal */
  warn(message: KernelMessage): void {
    try { this.warning(message); }
    catch { /* Diagnostics must not change the write outcome. */ }
  }
  private report(lock: RecoveredLock): void { this.warn(recoveredLockMessage(lock)); }
  private async cleanupLock(lock: string, token: string): Promise<void> {
    let warning: KernelMessage | undefined;
    try {
      const outcome = await this.releaseLock(lock, token);
      if (outcome === 'foreign') warning = kernelMessage('LOCK_LEFT_FOREIGN', { lock: writerLockName });
      else if (outcome === 'missing') warning = kernelMessage('LOCK_REMOVED_BY_OTHER', { lock: writerLockName });
    } catch (error) {
      // A cleanup failure cannot erase committed changes or the primary error.
      warning = kernelMessage('LOCK_UNREMOVABLE', { lock: writerLockName, diagnostic: errorMessage(error) });
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
        try { staged[index] = await this.stage(plan.target, plan.write.bytes, plan.before?.mode, plan.stagingDirectory); }
        catch (error) { failures.push(error); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(stagingConcurrency, plans.length) }, worker));
    if (failures.length) throw failures[0];
  }
  /** Write a temporary file for `target`, in its folder unless `directory` is given, whose data is durable before any rename publishes it. */
  private async stage(target: string, bytes: Uint8Array, mode?: number, directory = dirname(target)): Promise<string> {
    const temp = join(directory, `${temporaryPrefix}${randomUUID()}`);
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
/**
 * The files `list()` of the repository at `files` returns below `directory` (default: the root), relative to it and
 * in the same order. Each file that `stamped` accepts (default: every file) carries an opaque stamp of its size,
 * nanosecond modification and status-change times and inode, and `changedMs`, the later of both times; the others
 * are listed by name only, without a status call. `checkedAtMs` is taken before the first stamp. Stamped files that
 * vanish during the walk are left out; a symlinked or missing `directory` fails like `resolvePath`. The walk uses
 * synchronous calls: thousands of small status calls cost several times more through the thread pool.
 */
export async function stampedFiles(files: NodeFiles, directory?: string, stamped: (path: string) => boolean = () => true): Promise<{ checkedAtMs: number; files: Array<{ path: string } | ({ path: string } & FileStamp)> }> {
  const checkedAtMs = Date.now();
  const listed: Array<{ path: string } | ({ path: string } & FileStamp)> = [];
  const scope = directory === undefined ? '' : `${vaultPath(directory)}/`;
  const walk = (folder: string, prefix: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (unlisted(entry.name, scope + path)) continue;
      if (entry.isDirectory()) walk(join(folder, entry.name), `${path}/`);
      else if (!entry.isFile()) continue;
      else if (!stamped(path)) listed.push({ path });
      else {
        const info = lstatSync(join(folder, entry.name), { bigint: true, throwIfNoEntry: false });
        if (info === undefined) continue;
        const changed = info.mtimeNs > info.ctimeNs ? info.mtimeNs : info.ctimeNs;
        listed.push({ path, stamp: `${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.ino}`, changedMs: Number(changed / 1_000_000n) });
      }
    }
  };
  walk(directory === undefined ? files.root : await files.resolvePath(directory, true), '');
  return { checkedAtMs, files: listed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}
