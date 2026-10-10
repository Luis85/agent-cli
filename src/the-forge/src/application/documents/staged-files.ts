import { AppError, ensure, forgeError } from '../../domain/shared/errors.ts';
import { vaultPath, type FileChange, type FileRename, type FileSnapshot, type FileStat, type RenameRequest, type WriteRequest } from '../../domain/documents/file.ts';
import { revisionConflict, snapshotWriteRequests } from '../../domain/documents/write-plan.ts';
import type { BatchResult, FileBatch, FileRepository, WriteBatchResult } from '../workspace/ports.ts';

/**
 * A file in the planned state. `origin` is the file as it was before the plan, wherever it moved since, or null for
 * a file the plan created; `written` marks planned content; `operation` is the plan operation that last placed or
 * wrote it. Planned revisions are opaque tokens: plans guard with the revisions files had before the plan.
 */
export interface StagedFile { bytes: Uint8Array; revision: string; origin: FileSnapshot | null; written: boolean; operation: number }
/** A folder move the plan made, in order, by the operation that made it. */
export interface StagedFolderMove { from: string; to: string; operation: number }

const notFound = (error: unknown) => error instanceof AppError && error.code === 'NOT_FOUND';
const inside = (path: string, folder: string) => path.startsWith(`${folder}/`);
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * An in-memory overlay of planned changes over a scope's repository, so a plan runs every operation through the
 * ordinary Workspace and FileManager before anything is written. Reads see earlier planned writes and moves;
 * commits apply in order, each guarded by the planned revision. Nothing reaches the underlying repository: the
 * planned state is committed afterwards as one guarded batch (see `plannedBatch`). Plans never remove files
 * permanently, so removals are refused.
 */
export class StagedFiles implements FileRepository {
  /** The plan operation the next commits belong to. */
  operation = -1;
  readonly folderMoves: StagedFolderMove[] = [];
  private readonly staged = new Map<string, StagedFile>();
  /** Paths whose original file left them; the underlying file is no longer visible there. */
  private readonly vacated = new Set<string>();
  private readonly vacatedFolders = new Set<string>();
  private readonly originals = new Map<string, FileSnapshot | null>();
  private listing: Promise<string[]> | undefined;
  private tokens = 0;

  constructor(readonly base: FileRepository) {}

  /** Planned files by path, in path order. */
  entries(): Array<[string, StagedFile]> { return [...this.staged].sort(([a], [b]) => byPath(a, b)); }

  /** The file as it was before the plan, unless the plan moved it away; null when there was none. */
  private async original(path: string): Promise<FileSnapshot | null> {
    if (this.vacated.has(path)) return null;
    if (!this.originals.has(path)) {
      let snapshot: FileSnapshot | null = null;
      try { if ((await this.base.stat(path)).kind === 'file') snapshot = await this.base.read(path); }
      catch (error) { if (!notFound(error)) throw error; }
      this.originals.set(path, snapshot);
    }
    return this.originals.get(path)!;
  }

  /** The planned file at `path`, or undefined. */
  async current(path: string): Promise<StagedFile | undefined> {
    const staged = this.staged.get(path);
    if (staged) return staged;
    const original = await this.original(path);
    return original ? { bytes: original.bytes, revision: original.revision, origin: original, written: false, operation: -1 } : undefined;
  }

  /** A folder as it was before the plan, or undefined when there was none. */
  async baseFolder(path: string): Promise<Extract<FileStat, { kind: 'folder' }> | undefined> {
    try {
      const stat = await this.base.stat(path);
      return stat.kind === 'folder' ? stat : undefined;
    } catch (error) { if (notFound(error)) return undefined; throw error; }
  }

  /** The revision `path` had before the plan: a file's origin revision (null for a planned file), else the original folder's. */
  async originalRevision(path: string): Promise<string | null> {
    const file = await this.current(path);
    if (file) return file.origin?.revision ?? null;
    return this.vacatedFolders.has(path) ? null : (await this.baseFolder(path))?.revision ?? null;
  }

  async read(path: string): Promise<FileSnapshot> {
    const file = await this.current(vaultPath(path));
    if (!file) throw forgeError('NOT_FOUND', `File not found: ${path}`);
    return { path, bytes: file.bytes, revision: file.revision };
  }

  async list(): Promise<string[]> {
    this.listing ??= this.base.list();
    const original = (await this.listing).filter(path => !this.vacated.has(path) && !this.staged.has(path));
    return [...original, ...this.staged.keys()].sort(byPath);
  }

  /** Planned files below `folder`, as folder-relative paths in path order. */
  private async filesUnder(folder: string): Promise<string[]> {
    const original = this.vacatedFolders.has(folder) ? [] : (await this.baseFolder(folder))?.files ?? [];
    const visible = original.filter(file => !this.vacated.has(`${folder}/${file}`) && !this.staged.has(`${folder}/${file}`));
    const planned = [...this.staged.keys()].filter(path => inside(path, folder)).map(path => path.slice(folder.length + 1));
    return [...visible, ...planned].sort(byPath);
  }

  async stat(path: string): Promise<FileStat> {
    path = vaultPath(path);
    const file = await this.current(path);
    if (file) return { path, kind: 'file', revision: file.revision, bytes: file.bytes.length };
    const files = await this.filesUnder(path), original = this.vacatedFolders.has(path) ? undefined : await this.baseFolder(path);
    if (!original && files.length === 0) throw forgeError('NOT_FOUND', `File or folder not found: ${path}`);
    const touched = files.some(file => this.staged.has(`${path}/${file}`)) || original?.files.some(file => this.vacated.has(`${path}/${file}`));
    if (original && !touched) return original;
    const revisions = await Promise.all(files.map(async file => `${file}\0${(await this.current(`${path}/${file}`))!.revision}`));
    const folders = [...new Set(files.flatMap(file => file.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))))].sort(byPath);
    return { path, kind: 'folder', revision: `planned-folder:${revisions.join('\n')}`, files, folders };
  }

  async writeBatch(writes: readonly WriteRequest[]): Promise<WriteBatchResult> {
    const { changes } = await this.commit({ writes });
    return { changes, folders: [] };
  }

  async remove(): Promise<FileChange> {
    throw forgeError('INVALID_PLAN', 'Plans move files to .trash; they never remove files permanently.');
  }

  /** Applies renames, then writes, in order; each is checked against the planned state at that point. */
  async commit(batch: FileBatch): Promise<BatchResult> {
    ensure((batch.removes ?? []).length === 0, 'INVALID_PLAN', 'Plans move files to .trash; they never remove files permanently.');
    const renames: FileRename[] = [], changes: FileChange[] = [];
    for (const rename of batch.renames ?? []) renames.push(...await this.rename(rename));
    for (const write of snapshotWriteRequests(batch.writes ?? [])) changes.push(await this.write(write));
    return { renames, changes, folders: [], removedFolders: [] };
  }

  private async rename(request: RenameRequest): Promise<FileRename[]> {
    const from = vaultPath(request.from), to = vaultPath(request.to);
    const entry = await this.stat(from);
    ensure(entry.revision === request.expectedRevision, 'CONFLICT', `File changed; read again before moving: ${from}`, revisionConflict(from, request.expectedRevision, entry.revision));
    // A case-only rename finds its own source on case-insensitive filesystems.
    if (from.toLowerCase() !== to.toLowerCase()) {
      const occupied = await this.stat(to).then(() => true, (error: unknown) => { if (notFound(error)) return false; throw error; });
      ensure(!occupied, 'DESTINATION_EXISTS', `Destination already exists: ${to}`, { path: to, from });
    }
    if (entry.kind === 'file') return [await this.moveFile(from, to)];
    this.folderMoves.push({ from, to, operation: this.operation });
    const moved = await Promise.all(entry.files.map(file => this.moveFile(`${from}/${file}`, `${to}/${file}`)));
    this.vacatedFolders.add(from);
    return [{ from, to, kind: 'folder' }, ...moved];
  }

  private async moveFile(from: string, to: string): Promise<FileRename & { kind: 'file' }> {
    const file = (await this.current(from))!;
    this.staged.delete(from);
    this.vacated.add(from);
    this.staged.set(to, { ...file, operation: this.operation });
    return { from, to, kind: 'file', revision: file.revision, bytes: file.bytes.length };
  }

  private async write(request: WriteRequest): Promise<FileChange> {
    const current = await this.current(request.path);
    ensure(request.expectedRevision === current?.revision, 'CONFLICT', `File changed; read again before modifying: ${request.path}`, revisionConflict(request.path, request.expectedRevision, current?.revision));
    const revision = `planned:${++this.tokens}`;
    this.staged.set(request.path, { bytes: request.bytes, revision, origin: current?.origin ?? null, written: true, operation: this.operation });
    return { path: request.path, revision, operation: current ? 'updated' : 'created', bytes: request.bytes.length };
  }
}
