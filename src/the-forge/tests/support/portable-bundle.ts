import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, lstat, mkdtemp, readFile, readdir, realpath, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { distribution } from './workspace.ts';

/**
 * Copying the 20 MB distribution once per end-to-end file wrote more than a gigabyte per run, and on Windows runners a
 * single copy could outlast its hook. Files that only run the CLI share one generic copy per build instead; files that
 * change the copy itself request a private one.
 */
const prefix = 'forge-portable-';
const marker = '.complete';
/** A shared copy unused for this long belongs to an earlier build or another checkout, and is removed. */
const staleAfterMs = 60 * 60 * 1000;
/** Windows can keep a folder busy for a moment after a process that used it ended. */
export const removal = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;

/** Copy the distribution into `target/bin` as a generic installation: repository-local self-management is not part of it. */
export async function copyGenericBundle(target: string): Promise<void> {
  await cp(distribution, join(target, 'bin'), { recursive: true });
  await copyFile(join(target, 'bin/config/default.json'), join(target, 'bin/config.json'));
  await rm(join(target, 'bin/data/context.json'), { force: true });
  await writeFile(join(target, 'package.json'), '{"type":"module"}');
}

/** Every file below `root` with its size and modification time, in path order; the marker is left out. */
async function inventory(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && !(entry.parentPath === root && entry.name === marker));
  const lines = await Promise.all(files.map(async entry => {
    const path = join(entry.parentPath, entry.name);
    const { size, mtimeMs } = await lstat(path);
    return `${relative(root, path).split('\\').join('/')}\t${size}\t${mtimeMs}`;
  }));
  return lines.sort();
}

/** Give every file below `root` back its write permission, so a stale copy can be removed on Windows too. */
async function writable(root: string): Promise<void> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter(entry => entry.isFile()).map(entry => chmod(join(entry.parentPath, entry.name), 0o644).catch(() => {})));
}

async function remove(path: string): Promise<void> {
  await writable(path);
  await rm(path, removal);
}

/** Remove shared copies and abandoned builds that no run used recently; a copy in use elsewhere is left alone. */
async function prune(temporary: string, current: string): Promise<void> {
  for (const name of await readdir(temporary).catch(() => [] as string[])) {
    if (!name.startsWith(prefix) || join(temporary, name) === current) continue;
    const path = join(temporary, name);
    const used = await lstat(join(path, marker)).catch(() => lstat(path)).catch(() => undefined);
    if (used !== undefined && Date.now() - used.mtimeMs > staleAfterMs) await remove(path).catch(() => {});
  }
}

/** Build the shared copy in a sibling folder and rename it into place, so no file ever sees a partial copy. */
async function build(temporary: string, root: string): Promise<void> {
  const staging = await mkdtemp(`${root}-`);
  try {
    await copyGenericBundle(staging);
    const files = await inventory(staging);
    // Read-only files make an accidental write fail where it happens; the inventory also catches new files.
    await Promise.all(files.map(async line => {
      const path = join(staging, line.slice(0, line.indexOf('\t')));
      await chmod(path, (await lstat(path)).mode & ~0o222);
    }));
    await writeFile(join(staging, marker), JSON.stringify(await inventory(staging)));
    const complete = async () => await lstat(join(root, marker)).catch(() => undefined) !== undefined;
    try { await rename(staging, root); }
    catch (error) {
      // Another worker finished the same copy first; use theirs. A copy without its marker was invalidated after a
      // test changed it, and is replaced.
      if (await complete()) return;
      await remove(root);
      try { await rename(staging, root); }
      catch { if (!await complete()) throw error; }
    }
  } finally { await remove(staging).catch(() => {}); }
  await prune(temporary, root);
}

/** The bin folder of a portable CLI shared by every file of this build, and a check that no test changed it. */
export interface SharedBundle { root: string; verify(): Promise<void> }

export async function sharedBundle(): Promise<SharedBundle> {
  const temporary = await realpath(tmpdir());
  const key = createHash('sha256').update((await inventory(distribution)).join('\n')).digest('hex').slice(0, 16);
  const root = join(temporary, `${prefix}${key}`);
  const complete = join(root, marker);
  if (await lstat(complete).catch(() => undefined) === undefined) await build(temporary, root);
  const now = new Date();
  await utimes(complete, now, now);
  const recorded = JSON.parse(await readFile(complete, 'utf8')) as string[];
  return {
    root,
    async verify() {
      const current = await inventory(root);
      const changed = [...current.filter(line => !recorded.includes(line)), ...recorded.filter(line => !current.includes(line))]
        .map(line => line.slice(0, line.indexOf('\t')));
      if (changed.length === 0) return;
      // Later files rebuild the copy instead of running a changed CLI.
      await rm(complete, { force: true });
      throw new Error(`A test changed the shared portable CLI copy ${root}: ${[...new Set(changed)].join(', ')}. Use portableCli({ privateBundle: true }) for tests that change the bundle.`);
    },
  };
}
