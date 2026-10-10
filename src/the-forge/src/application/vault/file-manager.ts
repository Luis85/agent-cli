import { AppError, ensure, forgeError, isRecord } from '../../domain/shared/errors.ts';
import { fileKind, isInTrash, trashFolder, vaultPath, type FileSnapshot, type FileStat, type WriteRequest } from '../../domain/documents/file.ts';
import { revisionConflict } from '../../domain/documents/write-plan.ts';
import type { Workspace } from '../workspace/workspace.ts';
import type { Backlink, MetadataIndex } from '../metadata/ports.ts';
import { planLinkUpdates, rewriteText, type UnrewrittenLink } from './link-plan.ts';

/** `ifMatch` guards the source: a file revision or a folder revision from `stat`. Without it the current revision is used. */
export interface MoveOptions { ifMatch?: string; updateLinks?: boolean }
export interface DeleteOptions { ifMatch?: string; permanent?: boolean; allowBrokenLinks?: boolean; recursive?: boolean }
/** A link into a deleted file or folder; `line` is 1-based for body links and null for frontmatter and Canvas links. */
export interface BrokenLink { source: string; target: string; kind: Backlink['kind']; line: number | null; original: string; key?: string; node?: string }
/** A file or folder a delete removed from its path: files in batch order, then folders, child before parent. */
interface DeletedEntry { path: string; kind: 'file' | 'folder'; revision?: string; bytes?: number }
/** Which paths are off limits: the scope root's `.obsidian` and `.forge` always, and `bin` at workspace scope. */
export interface FileManagerScope { workspace: boolean }

const encoder = new TextEncoder();
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const notFound = (error: unknown) => error instanceof AppError && error.code === 'NOT_FOUND';
const json = (value: unknown) => JSON.stringify(value);
const folders = (paths: readonly string[]) => paths.map((path): DeletedEntry => ({ path, kind: 'folder' }));

/**
 * Obsidian's FileManager for the agent: moves and renames that keep every link intact, guarded deletion to the
 * vault trash, and atomic frontmatter edits. Everything runs through the scope's Workspace, so dry runs, revision
 * guards, `vault.*` records and post-commit metadata events stay identical to every other write.
 */
export class FileManager {
  constructor(private readonly workspace: Workspace, private readonly metadata: MetadataIndex, private readonly scope: FileManagerScope) {}

  /** Moves a file or folder and, unless `updateLinks` is false, rewrites every link to it in the same batch. */
  async move(from: string, to: string, options: MoveOptions = {}) {
    from = vaultPath(from); to = vaultPath(to);
    ensure(from !== to, 'INVALID_MOVE', `The destination equals the source: ${from}`);
    ensure(!to.startsWith(`${from}/`), 'INVALID_MOVE', `Cannot move ${from} into itself.`);
    this.ensureMovable(from); this.ensureMovable(to);
    const entry = await this.workspace.files.stat(from);
    await this.ensureAbsent(from, to);
    const moves = new Map(entry.kind === 'file' ? [[from, to]] : entry.files.map(file => [`${from}/${file}`, `${to}/${file}`]));
    const writes: WriteRequest[] = [], previous = new Map<string, FileSnapshot>(), unrewritten: UnrewrittenLink[] = [];
    let references = 0;
    if (options.updateLinks !== false) {
      const cache = await this.metadata.load();
      const plan = planLinkUpdates(cache, moves);
      references = plan.references;
      unrewritten.push(...plan.unrewritten);
      for (const file of plan.files) {
        const snapshot = await this.workspace.files.read(file.source);
        const rewritten = rewriteText(file, decode(snapshot.bytes), cache.getFileCache(file.source)!, (yaml, replacements) => this.workspace.codec.replaceInYamlStrings(yaml, replacements));
        // The cache was read moments ago in this invocation; a file edited since then is a conflict, not a guess.
        if (rewritten === undefined) throw forgeError('CONFLICT', `File changed while planning link updates; retry: ${file.source}`, revisionConflict(file.source, null, snapshot.revision));
        unrewritten.push(...rewritten.unrewritten);
        references -= rewritten.unrewritten.length;
        const path = moves.get(file.source) ?? file.source;
        writes.push({ path, bytes: encoder.encode(rewritten.text), expectedRevision: snapshot.revision });
        previous.set(path, snapshot);
      }
    }
    // Rewritten files are written, and reported, in the path order they have after the move.
    writes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const result = await this.workspace.commit({ renames: [{ from, to, expectedRevision: options.ifMatch ?? entry.revision }], writes }, { operation: 'move', previous });
    return { dryRun: result.dryRun, from, to, kind: entry.kind, revision: entry.revision, renames: result.renames, changes: result.changes, links: { updated: references, files: writes.length, unrewritten } };
  }

  /** Renames in place: `name` has no slash; a file keeps its extension when `name` omits it. */
  // Reached through `context.app.fileManager` by the CLI and plugins.
  // fallow-ignore-next-line unused-class-member
  async rename(path: string, name: string, options: MoveOptions = {}) {
    path = vaultPath(path);
    ensure(typeof name === 'string' && name.length > 0 && !name.includes('/'), 'INVALID_MOVE', 'rename takes a new name without slashes; use move to change folders.');
    const entry = await this.workspace.files.stat(path);
    const basename = path.slice(path.lastIndexOf('/') + 1), dot = basename.lastIndexOf('.');
    const extension = entry.kind === 'file' && dot > 0 ? basename.slice(dot) : '';
    const fullName = extension && !name.toLowerCase().endsWith(extension.toLowerCase()) ? name + extension : name;
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    return this.move(path, folder + vaultPath(fullName), options);
  }

  /**
   * Deletes a file, or a folder with `recursive`, moving it to `.trash/` unless `permanent` is set. Refuses with
   * HAS_BACKLINKS while files outside the deleted path link into it, unless `allowBrokenLinks` is set.
   */
  async delete(path: string, options: DeleteOptions = {}) {
    path = vaultPath(path);
    this.ensureMovable(path);
    const entry = await this.workspace.files.stat(path);
    ensure(entry.kind === 'file' || options.recursive === true, 'INVALID_ARGUMENT', `${path} is a folder; pass --recursive to delete it with its files.`);
    ensure(options.permanent === true || !isInTrash(path), 'INVALID_ARGUMENT', `${path} is already in ${trashFolder}; pass --permanent to remove it.`);
    const brokenLinks = await this.brokenLinks(path, entry);
    ensure(brokenLinks.length === 0 || options.allowBrokenLinks === true, 'HAS_BACKLINKS', `${brokenLinks.length} link(s) from other files still point into ${path}.`, { backlinks: brokenLinks });
    const expectedRevision = options.ifMatch ?? entry.revision;
    if (options.permanent === true) {
      const result = await this.workspace.commit({ removes: [{ path, expectedRevision }] }, { operation: 'delete' });
      const deleted = [...result.changes.map(({ path: file, revision, bytes }): DeletedEntry => ({ path: file, kind: 'file', revision, bytes })), ...folders(result.removedFolders)];
      return { dryRun: result.dryRun, path, kind: entry.kind, revision: entry.revision, permanent: true, trashPath: null, deleted, brokenLinks };
    }
    const trashPath = await this.trashDestination(path, entry.kind);
    const result = await this.workspace.commit({ renames: [{ from: path, to: trashPath, expectedRevision }] }, { operation: 'delete', trash: true });
    const deleted = [
      ...result.renames.flatMap((rename): DeletedEntry[] => rename.kind === 'file' ? [{ path: rename.from, kind: 'file', revision: rename.revision, bytes: rename.bytes }] : []),
      ...folders(result.renames.flatMap(rename => rename.kind === 'folder' ? [rename.from] : []).sort().reverse()),
    ];
    return { dryRun: result.dryRun, path, kind: entry.kind, revision: entry.revision, permanent: false, trashPath, deleted, brokenLinks };
  }

  /** Obsidian's `renameFile`: a move that updates links. */
  // Reached through `context.app.fileManager` by the CLI and plugins.
  // fallow-ignore-next-line unused-class-member
  renameFile(path: string, newPath: string, options: Omit<MoveOptions, 'updateLinks'> = {}) {
    return this.move(path, newPath, { ...options, updateLinks: true });
  }

  /** Obsidian's `trashFile`: moves a file or folder to `.trash/`, refusing while other files link into it. */
  // Reached through `context.app.fileManager` by the CLI and plugins.
  // fallow-ignore-next-line unused-class-member
  trashFile(path: string, options: Omit<DeleteOptions, 'permanent' | 'recursive'> = {}) {
    return this.delete(path, { ...options, recursive: true });
  }

  /**
   * Obsidian's `processFrontMatter`: `fn` mutates a copy of the note's properties; changed keys are set and removed
   * keys deleted in one guarded edit that preserves the body. Without `ifMatch`, the revision read here guards it.
   */
  // Reached through `context.app.fileManager` by the CLI and plugins.
  // fallow-ignore-next-line unused-class-member
  async processFrontMatter(path: string, fn: (frontmatter: Record<string, unknown>) => void | Promise<void>, options: { ifMatch?: string } = {}) {
    ensure(fileKind(path) === 'markdown', 'UNSUPPORTED_EDIT', 'Frontmatter requires a Markdown note.');
    ensure(typeof fn === 'function', 'INVALID_ARGUMENT', 'processFrontMatter needs a function.');
    const snapshot = await this.workspace.files.read(path);
    const revision = options.ifMatch ?? snapshot.revision;
    ensure(snapshot.revision === revision, 'CONFLICT', `File changed; read again before editing: ${path}`, revisionConflict(path, revision, snapshot.revision));
    const before = (this.workspace.codec.inspect(path, snapshot.bytes) as { properties: Record<string, unknown> }).properties;
    const after = structuredClone(before);
    await fn(after);
    ensure(isRecord(after), 'INVALID_FRONTMATTER', 'Frontmatter must stay a mapping.');
    const changes = Object.fromEntries(Object.entries(after).filter(([key, value]) => json(value) !== json(before[key])));
    const removed = Object.keys(before).filter(key => !Object.hasOwn(after, key));
    // Like Obsidian, an unchanged frontmatter writes nothing.
    if (Object.keys(changes).length + removed.length === 0) return { dryRun: this.workspace.dryRun, changes: [] };
    return this.workspace.edit(path, revision, bytes => this.workspace.codec.properties(bytes, changes, removed));
  }

  /** Links from outside `path` that resolve to it or into it. */
  private async brokenLinks(path: string, entry: FileStat): Promise<BrokenLink[]> {
    const cache = await this.metadata.load();
    const targets = entry.kind === 'file' ? [path] : entry.files.map(file => `${path}/${file}`);
    const inside = new Set(targets);
    return targets.flatMap(target => cache.backlinks(target).filter(link => !inside.has(link.source)).map((link): BrokenLink => {
      const reference = link.reference as { original: string; position?: { start: { line: number } }; key?: string; node?: string };
      return {
        source: link.source, target, kind: link.kind, line: reference.position ? reference.position.start.line + 1 : null, original: reference.original,
        ...(reference.key === undefined ? {} : { key: reference.key }), ...(reference.node === undefined ? {} : { node: reference.node }),
      };
    }));
  }

  /** `.trash/<path>`, or with ` 1`, ` 2`… before the extension when that name is taken, as Obsidian names trash copies. */
  private async trashDestination(path: string, kind: FileStat['kind']): Promise<string> {
    const slash = path.lastIndexOf('/'), name = path.slice(slash + 1), dot = kind === 'file' ? name.lastIndexOf('.') : -1;
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    const folder = `${trashFolder}/${path.slice(0, slash + 1)}`;
    for (let copy = 0; ; copy++) {
      const candidate = `${folder}${stem}${copy === 0 ? '' : ` ${copy}`}${extension}`;
      try { await this.workspace.files.stat(candidate); }
      catch (error) { if (notFound(error)) return candidate; throw error; }
    }
  }

  private async ensureAbsent(from: string, to: string): Promise<void> {
    try {
      await this.workspace.files.stat(to);
      // A case-only rename finds its own source on case-insensitive filesystems; the batch checks identity.
      ensure(from.toLowerCase() === to.toLowerCase(), 'DESTINATION_EXISTS', `Destination already exists: ${to}`, { path: to, from });
    } catch (error) { if (!notFound(error)) throw error; }
  }

  /** Protected roots are compared without letter case: on case-insensitive filesystems `.Obsidian` is `.obsidian`. */
  private ensureMovable(path: string): void {
    const top = path.split('/')[0]!;
    const protectedRoots = ['.obsidian', '.forge', ...(this.scope.workspace ? ['bin'] : [])];
    ensure(!protectedRoots.includes(top.toLowerCase()), 'PROTECTED_PATH', `${top} is protected; Forge does not move or delete it.`, { path, protected: top });
  }
}
