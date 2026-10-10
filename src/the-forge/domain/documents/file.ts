import { ensure } from '../shared/errors.ts';

export function vaultPath(input: string): string {
  // oxlint-disable-next-line no-control-regex -- Vault paths must reject ASCII control characters.
  ensure(typeof input === 'string' && input.length > 0 && !/[\x00-\x1f\\:]/.test(input), 'INVALID_PATH', 'Use a nonempty, relative POSIX path.');
  const parts = input.split('/');
  ensure(parts.every(p => p && p !== '.' && p !== '..'), 'INVALID_PATH', 'Absolute paths, empty segments and traversal are forbidden.');
  ensure(!parts.some(p => ['.git', '.agent-cli.lock'].includes(p) || p.startsWith('.agent-cli-tmp-')), 'INVALID_PATH', 'Reserved workspace path.');
  return input;
}

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
/** Source, data and configuration files read and edited as UTF-8 text. Extensionless names and dotfiles stay attachments. */
export const textExtensions = [
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'vue', 'svelte', 'txt', 'log', 'csv', 'tsv', 'sh', 'py', 'sql',
] as const;
export const fileKinds = [...Object.keys(nativeFormats), 'text', 'attachment'];
export function fileKind(path: string): string {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  const ext = dot < 0 ? '' : basename.slice(dot + 1).toLowerCase();
  const native = Object.entries(nativeFormats).find(([, extensions]) => (extensions as readonly string[]).includes(ext))?.[0];
  return native ?? ((textExtensions as readonly string[]).includes(ext) ? 'text' : 'attachment');
}
export const isStructured = (path: string) => ['markdown', 'canvas', 'base'].includes(fileKind(path));
/** Kinds whose UTF-8 content can be edited literally and previewed as a line diff. */
export const isTextLike = (path: string) => isStructured(path) || fileKind(path) === 'text';

export interface FileSnapshot { path: string; bytes: Uint8Array; revision: string }
export interface WriteRequest { path: string; bytes: Uint8Array; expectedRevision?: string }
export interface FileChange { path: string; revision: string; operation: 'created' | 'updated' | 'deleted'; bytes: number }
/** Dry-run change with a unified diff for UTF-8 text-like files, or null for binary content. */
export interface PlannedChange extends FileChange { diff: string | null }
