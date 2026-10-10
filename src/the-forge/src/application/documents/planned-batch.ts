import { forgeError } from '../../domain/shared/errors.ts';
import type { FileSnapshot, RenameRequest, WriteRequest } from '../../domain/documents/file.ts';
import type { FileBatch } from '../workspace/ports.ts';
import type { StagedFile, StagedFiles } from './staged-files.ts';

/**
 * The planned state as one guarded batch: `previous` holds the original of each written file for dry-run diffs,
 * `trash` the trash destinations among the renames, and `operations` the plan operation behind each batch path.
 */
export interface PlannedBatch { batch: Required<Pick<FileBatch, 'renames' | 'writes'>>; previous: Map<string, FileSnapshot>; trash: string[]; operations: Map<string, number> }

type Moved = [string, StagedFile & { origin: FileSnapshot }];
const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);
const depth = (path: string) => path.split('/').length;
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

/** Where the plan's folder moves took `folder`: each move of it, or of a folder containing it, in order. */
function destination(staged: StagedFiles, folder: string): string {
  let location = folder;
  for (const move of staged.folderMoves) if (within(location, move.from)) location = move.to + location.slice(move.from.length);
  return location;
}

/**
 * A folder the plan moved becomes one folder rename when its original files all arrived, unchanged in layout, in
 * one new folder that existed nowhere before and that no other original file moved into. Otherwise its files move
 * one by one and the emptied original folder stays.
 */
async function folderRenames(staged: StagedFiles, moved: readonly Moved[], covered: Set<string>): Promise<RenameRequest[]> {
  const renames: RenameRequest[] = [];
  const candidates = [...new Set(staged.folderMoves.map(move => move.from))].sort((a, b) => depth(a) - depth(b));
  for (const folder of candidates) {
    if (renames.some(rename => within(folder, rename.from))) continue;
    const original = await staged.baseFolder(folder);
    const target = destination(staged, folder);
    if (!original || target === folder || await staged.base.stat(target).then(() => true, () => false)) continue;
    const arrived = new Map(moved.filter(([path]) => within(path, target)).map(([path, file]) => [file.origin.path, path]));
    const together = arrived.size === original.files.length && original.files.every(file => arrived.get(`${folder}/${file}`) === `${target}/${file}`);
    if (!together) continue;
    renames.push({ from: folder, to: target, expectedRevision: original.revision });
    for (const file of original.files) covered.add(`${folder}/${file}`);
  }
  return renames;
}

/**
 * Translates the planned state into one batch: each original file at a new path becomes a rename (whole folders
 * where possible) guarded by its original revision, and each file with planned content a write guarded by the
 * original's revision, or a creation. A write or move into a path that the same batch vacates cannot be committed
 * atomically and fails with INVALID_PLAN, naming the operation.
 */
export async function plannedBatch(staged: StagedFiles, trashDestinations: readonly string[]): Promise<PlannedBatch> {
  const entries = staged.entries();
  const moved = entries.filter((entry): entry is Moved => entry[1].origin !== null && entry[1].origin.path !== entry[0]);
  const covered = new Set<string>(), operations = new Map<string, number>();
  const renames = await folderRenames(staged, moved, covered);
  for (const rename of renames) operations.set(rename.to, staged.folderMoves.find(move => move.from === rename.from)!.operation);
  for (const [path, file] of moved) {
    operations.set(path, file.operation);
    if (!covered.has(file.origin.path)) renames.push({ from: file.origin.path, to: path, expectedRevision: file.origin.revision });
  }
  const writes: WriteRequest[] = [], previous = new Map<string, FileSnapshot>();
  for (const [path, file] of entries) {
    if (!file.written || (file.origin && sameBytes(file.bytes, file.origin.bytes))) continue;
    // A file the plan both created and deleted never reaches the vault or its trash.
    if (!file.origin && trashDestinations.some(destination => within(path, destination))) continue;
    writes.push({ path, bytes: file.bytes, ...(file.origin ? { expectedRevision: file.origin.revision } : {}) });
    if (file.origin) previous.set(path, file.origin);
    operations.set(path, file.operation);
  }
  renames.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const sources = renames.map(rename => rename.from);
  for (const path of [...renames.map(rename => rename.to), ...writes.filter(write => write.expectedRevision === undefined).map(write => write.path)]) {
    const source = sources.find(candidate => within(path, candidate) || within(candidate, path));
    if (source === undefined) continue;
    const operation = operations.get(path)!;
    throw forgeError('INVALID_PLAN', `Operation ${operation} places ${path} where the same plan moves or deletes ${source}; one batch cannot reuse a vacated path. Split the plan in two.`, { operation, path, vacated: source });
  }
  const trash = trashDestinations.filter(path => renames.some(rename => within(rename.to, path)));
  return { batch: { renames, writes }, previous, trash, operations };
}
