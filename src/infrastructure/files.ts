import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, mkdir, realpath, rename, rm, rmdir, writeFile, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { AppError, ensure } from '../domain/errors.ts';
import { vaultPath, type WriteRequest, type FileChange } from '../domain/file.ts';
import type { FileRepository } from '../application/ports.ts';

export const revisionOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export class NodeFiles implements FileRepository {
  private constructor(readonly root: string) {}
  static async at(root: string): Promise<NodeFiles> { return new NodeFiles(await realpath(resolve(root))); }
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
  async writeBatch(writes: readonly WriteRequest[], dryRun: boolean): Promise<FileChange[]> {
    ensure(writes.length > 0 && new Set(writes.map(w => vaultPath(w.path))).size === writes.length, 'INVALID_PLAN', 'Plan must contain unique file paths.');
    const lock = join(this.root, '.agent-cli.lock');
    let locked = false;
    const createdDirectories: string[] = [];
    const committed: Array<{ target: string; before?: Buffer }> = [];
    try {
      if (!dryRun) {
        try { const handle = await open(lock, 'wx'); locked = true; await handle.close(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError('WORKSPACE_BUSY', 'Another writer holds .agent-cli.lock. Retry after it finishes.', 4); throw error; }
      }
      const plans = [];
      for (const write of writes) {
        const target = await this.resolvePath(write.path);
        let before: Buffer | undefined;
        try { before = await readFile(target); } catch (error) { if (!missing(error)) throw error; }
        ensure(before === undefined ? write.expectedRevision === undefined : write.expectedRevision === revisionOf(before), 'CONFLICT', `Existing files require their current --if-match revision: ${write.path}`);
        plans.push({ write, target, before });
      }
      // Reject file/parent collisions before creating anything.
      ensure(!writes.some(a => writes.some(b => b.path.startsWith(a.path + '/'))), 'INVALID_PLAN', 'A generated file cannot also be a directory.');
      if (!dryRun) for (const plan of plans) {
        const parts = plan.write.path.split('/').slice(0, -1);
        let directory = this.root;
        for (const part of parts) {
          directory = join(directory, part);
          try { await mkdir(directory); createdDirectories.push(directory); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        }
        await this.resolvePath(plan.write.path);
        await this.replace(plan.target, plan.write.bytes);
        committed.push(plan);
      }
      return plans.map(({ write, before }) => ({ path: write.path, revision: revisionOf(write.bytes), operation: before === undefined ? 'created' : 'updated', bytes: write.bytes.length }));
    } catch (error) {
      const failures: string[] = [];
      for (const entry of committed.reverse()) {
        try { if (entry.before) await this.replace(entry.target, entry.before); else await rm(entry.target); }
        catch { failures.push(entry.target); }
      }
      for (const directory of createdDirectories.reverse()) await rmdir(directory).catch(() => {});
      if (failures.length) throw new AppError('ROLLBACK_FAILED', `Inspect these files before retrying: ${failures.join(', ')}`);
      throw error;
    } finally { if (locked) await rm(lock, { force: true }); }
  }
  private async replace(target: string, bytes: Uint8Array): Promise<void> {
    const temp = join(resolve(target, '..'), `.agent-cli-tmp-${randomUUID()}`);
    let mode = 0o666;
    try { mode = (await lstat(target)).mode; } catch (error) { if (!missing(error)) throw error; }
    try { await writeFile(temp, bytes, { flag: 'wx', mode }); await rename(temp, target); }
    finally { await rm(temp, { force: true }); }
  }
}
