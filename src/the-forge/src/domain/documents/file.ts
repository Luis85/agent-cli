import { ensure } from '../shared/errors.ts';

/** The workspace writer lock's file name at a workspace (or nested) root. */
export const writerLockName = '.agent-cli.lock';
/** The prefix of Forge's temporary files: staged writes, parked removals, lock records and break guards. */
export const temporaryPrefix = '.agent-cli-tmp-';
/** Code points HFS+ ignores in names: zero-width and directional marks, word joiners and the byte order mark. */
const ignorable = /[\u200b-\u200f\u202a-\u202e\u2060-\u2063\ufeff]/g;
/** A name as case-insensitive filesystems, Windows trailing-dot/space aliases and HFS+ ignorable code points resolve it. */
const canonicalName = (segment: string) => segment.replace(ignorable, '').toLowerCase().replace(/[. ]+$/, '');
/**
 * Whether `canonical` has the shape of a Windows 8.3 short name of `name`: its first six name characters without
 * dots or spaces, `~` and a number, and any extension (`GIT~1` for `.git`, `AGENT-~1.LOC` for the lock).
 */
function shortAlias(canonical: string, name: string): boolean {
  const long = name.replace(/^\.+/, ''), dot = long.lastIndexOf('.');
  const base = (dot > 0 ? long.slice(0, dot) : long).replace(/[. ]/g, '').slice(0, 6);
  const tilde = canonical.lastIndexOf('~'), extension = canonical.indexOf('.', tilde);
  const number = canonical.slice(tilde + 1, extension < 0 ? undefined : extension);
  return tilde > 0 && canonical.slice(0, tilde) === base && /^\d+$/.test(number);
}
/**
 * Whether `segment` names `name` (lower case) on some filesystem: in another letter case, with trailing dots or
 * spaces (Windows), with ignorable code points (HFS+), or as a Windows 8.3 short name.
 */
export function aliasesName(segment: string, name: string): boolean {
  const canonical = canonicalName(segment);
  return canonical === name || shortAlias(canonical, name);
}

/** Reserved names also cover case-insensitive filesystems, Windows trailing-dot/space and short-name aliases and HFS+ ignorable code points. */
export function reservedPathSegment(segment: string): 'git' | 'internal' | undefined {
  if (aliasesName(segment, '.git')) return 'git';
  // Temporary names share the lock's short name shape (`AGENT-~N`).
  if (aliasesName(segment, writerLockName) || canonicalName(segment).startsWith(temporaryPrefix)) return 'internal';
  return undefined;
}

/** Windows device names: a file named like one, with any extension, opens the device instead on Windows. */
const deviceNames = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
/**
 * Whether `segment` is a Windows reserved device name in any letter case, alone or with an extension, and with
 * trailing dots or spaces before or after the extension (`con`, `NUL.md`, `Com1 .txt`, `lpt9.tar.gz.`).
 */
export function isDeviceName(segment: string): boolean {
  const base = segment.replace(ignorable, '').split('.')[0]!;
  return deviceNames.test(base.toLowerCase().replace(/ +$/, ''));
}

export function vaultPath(input: string): string {
  // oxlint-disable-next-line no-control-regex -- Vault paths must reject ASCII control characters.
  ensure(typeof input === 'string' && input.length > 0 && !/[\x00-\x1f\x7f\\:]/.test(input), 'INVALID_PATH', 'Use a nonempty, relative POSIX path.');
  const parts = input.split('/');
  // A segment of only dots, spaces and ignorable code points is empty, `.` or `..` on Windows or HFS+.
  ensure(parts.every(p => canonicalName(p) !== ''), 'INVALID_PATH', 'Absolute paths, empty segments and traversal are forbidden.');
  ensure(!parts.some(p => reservedPathSegment(p) !== undefined), 'INVALID_PATH', 'Reserved workspace path.');
  // Rejected on every platform, so a vault stays usable when it is synced to or opened on Windows.
  const device = parts.find(isDeviceName);
  ensure(device === undefined, 'INVALID_PATH', `${device} is a Windows reserved device name (CON, PRN, AUX, NUL, COM1-COM9 or LPT1-LPT9, with any extension); rename the file or folder.`, { segment: device });
  return input;
}

/** Obsidian's vault trash: `delete` moves files here unless `--permanent` is passed. It is hidden from the metadata cache. */
export const trashFolder = '.trash';
/** Whether a path lies in the vault trash; letter case is ignored, as case-insensitive filesystems name one folder. */
export const isInTrash = (path: string) => path.toLowerCase() === trashFolder || path.toLowerCase().startsWith(`${trashFolder}/`);

/** Recursive libraries must not copy definitions into their own discovery scope. */
export function ensureSeparateDirectories(source: string, destination: string): void {
  vaultPath(source); vaultPath(destination);
  ensure(source !== destination && !source.startsWith(`${destination}/`) && !destination.startsWith(`${source}/`), 'INVALID_PATH', 'Import and export directories must be separate; neither may contain the other.');
}

export const nativeFormats = {
  markdown: ['md'], canvas: ['canvas'], base: ['base'],
  image: ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'],
  audio: ['flac', 'm4a', 'mp3', 'ogg', 'wav', 'webm', '3gp'],
  video: ['mkv', 'mov', 'mp4', 'ogv', 'webm'], pdf: ['pdf'],
} as const;
/** Source, data and configuration extensions read and edited as UTF-8 text. */
export const textExtensions = [
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'vue', 'svelte', 'txt', 'log', 'csv', 'tsv', 'sh', 'ps1', 'psm1', 'psd1', 'py', 'sql',
] as const;
/**
 * Basenames read as UTF-8 text, case-insensitively, alone or with a dot suffix that starts with another character
 * (`Dockerfile.release`, not `Dockerfile.` or `Dockerfile..release`); native extensions win.
 */
export const textFilenames = ['Dockerfile', 'Containerfile'] as const;
export const fileKinds = [...Object.keys(nativeFormats), 'text', 'attachment'];
export function fileKind(path: string): string {
  const basename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = basename.lastIndexOf('.');
  const ext = dot < 0 ? '' : basename.slice(dot + 1);
  const native = Object.entries(nativeFormats).find(([, extensions]) => (extensions as readonly string[]).includes(ext))?.[0];
  const namedText = textFilenames.some(name => {
    const lower = name.toLowerCase();
    return basename === lower || (basename.startsWith(`${lower}.`) && /^[^.]/.test(basename.slice(lower.length + 1)));
  });
  return native ?? ((textExtensions as readonly string[]).includes(ext) || namedText ? 'text' : 'attachment');
}
/**
 * Whether decoded UTF-8 is usable as the content of `path`. A `text` extension is only a hint: content holding U+0000
 * is binary, as Git treats NUL bytes, which also keeps BOM-less UTF-16 (valid UTF-8 byte for byte) out of text edits.
 */
export const isTextContent = (path: string, text: string) => fileKind(path) !== 'text' || !text.includes('\0');
export const isStructured = (path: string) => ['markdown', 'canvas', 'base'].includes(fileKind(path));
/** Kinds whose UTF-8 content can be edited literally and previewed as a line diff. */
export const isTextLike = (path: string) => isStructured(path) || fileKind(path) === 'text';

export interface FileSnapshot { path: string; bytes: Uint8Array; revision: string }
/** A check-only file or folder condition; an omitted revision requires the path to be absent. */
export interface GuardRequest { path: string; expectedRevision?: string }
export interface WriteRequest { path: string; bytes: Uint8Array; expectedRevision?: string }
/**
 * One file change in batch order. `unchanged` is a write whose bytes equal the stored file: nothing is written or
 * published. `alreadyApplied` marks such a write whose revision guard did not match (an existing file for a create,
 * or a stale revision): the file already holds exactly the requested bytes, as after a retried request.
 */
export interface FileChange { path: string; revision: string; operation: 'created' | 'updated' | 'deleted' | 'unchanged'; bytes: number; alreadyApplied?: true }
/** A guarded move of a file or folder. A folder's `expectedRevision` is its folder revision (see `FileStat`). */
export interface RenameRequest { from: string; to: string; expectedRevision: string }
/** A guarded removal of a file or, recursively, a folder. A folder's `expectedRevision` is its folder revision. */
export interface RemoveRequest { path: string; expectedRevision: string }
/**
 * One committed move. A folder move reports the folder first, then every moved descendant folder and file in
 * path order. Files carry their unchanged revision and size.
 */
export type FileRename = { from: string; to: string } & ({ kind: 'file'; revision: string; bytes: number } | { kind: 'folder' });
/**
 * A file's revision and size, or a folder's revision and contents. A folder revision is the SHA-256 of each
 * contained file's folder-relative path and revision, in path order; any change inside the folder changes it.
 */
export type FileStat =
  | { path: string; kind: 'file'; revision: string; bytes: number }
  | { path: string; kind: 'folder'; revision: string; files: string[]; folders: string[] };
/** Dry-run change with a unified diff for UTF-8 text-like files, or null for binary content. */
export interface PlannedChange extends FileChange { diff: string | null }
