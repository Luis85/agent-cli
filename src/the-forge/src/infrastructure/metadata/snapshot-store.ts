import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensure, isRecord } from '../../domain/shared/errors.ts';
import { snapshotFormat, type MetadataSnapshot } from '../../domain/metadata/snapshot.ts';
import type { MetadataSnapshotStore, StampedListing } from '../../application/metadata/ports.ts';
import { retryTransient } from '../workspace/retry.ts';
import { cacheFolder } from '../workspace/files.ts';

const documentType = 'forge-metadata-snapshot';

/**
 * The workspace-relative snapshot file of a scope: one file for the workspace root and one per project directory,
 * all in the workspace's `.forge/cache`, so project trees and their folder revisions never contain cache files.
 */
export function snapshotFile(projectDirectory: string | null): string {
  const scope = projectDirectory === null ? 'workspace' : `project.${encodeURIComponent(projectDirectory)}`;
  return `${cacheFolder}/metadata.v${snapshotFormat}.${scope}.json`;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Stores metadata snapshots as one file: a header line naming the document type, the build of the running program
 * and the SHA-256 of the JSON body, then the body. A file whose header, build or digest does not match (truncated,
 * corrupt, foreign or from another build) reads as no snapshot. Saving writes a temporary file next to the target
 * and renames it over, without the writer lock and without events; the folder gets a `.gitignore` that ignores it.
 * Like every workspace path, the cache folders must not be symlinks: the store neither reads nor writes through one.
 */
export class NodeMetadataSnapshotStore implements MetadataSnapshotStore {
  private build: Promise<string> | undefined;

  /**
   * `file` is relative to the workspace `root` (see `snapshotFile`); `program` is the running bundle, whose size and
   * modification time identify the build.
   */
  constructor(private readonly root: string, private readonly file: string, private readonly program: string, private readonly list: (stamped: (path: string) => boolean) => Promise<StampedListing>) {}

  listing(stamped: (path: string) => boolean): Promise<StampedListing> { return this.list(stamped); }

  async load(): Promise<unknown> {
    try {
      const text = await readFile(await this.folder(false).then(folder => join(folder, this.name)), 'utf8');
      const end = text.indexOf('\n');
      if (end < 0) return null;
      const header: unknown = JSON.parse(text.slice(0, end));
      const body = text.slice(end + 1);
      if (!isRecord(header) || header.type !== documentType || header.build !== await this.identity() || header.digest !== sha256(body)) return null;
      return JSON.parse(body) as unknown;
    } catch { return null; }
  }

  async save(snapshot: MetadataSnapshot): Promise<void> {
    const body = JSON.stringify(snapshot);
    const header = JSON.stringify({ type: documentType, build: await this.identity(), digest: sha256(body) });
    const folder = await this.folder(true);
    await writeFile(join(folder, '.gitignore'), '*\n', { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
    const temp = join(folder, `.${this.name}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, `${header}\n${body}`);
      await retryTransient(() => rename(temp, join(folder, this.name)));
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  private get name(): string { return this.file.slice(this.file.lastIndexOf('/') + 1); }

  /** The absolute cache folder after checking that no segment is a symlink or a file; `create` makes missing ones. */
  private async folder(create: boolean): Promise<string> {
    let current = this.root;
    for (const part of this.file.split('/').slice(0, -1)) {
      current = join(current, part);
      const info = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT' && create) return null; throw error; });
      if (info === null) await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      else ensure(info.isDirectory() && !info.isSymbolicLink(), 'UNSAFE_PATH', `The metadata cache folder ${this.file.split('/').slice(0, -1).join('/')} must be a folder, not a symlink or file.`);
    }
    return current;
  }

  private identity(): Promise<string> {
    this.build ??= stat(this.program).then(info => `${info.size}:${info.mtimeMs}`, () => 'unknown');
    return this.build;
  }
}
