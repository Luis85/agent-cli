import { ensure } from './errors.ts';

export function vaultPath(input: string): string {
  ensure(typeof input === 'string' && input.length > 0 && !/[\x00-\x1f\\:]/.test(input), 'INVALID_PATH', 'Use a nonempty, relative POSIX path.');
  const parts = input.split('/');
  ensure(parts.every(p => p && p !== '.' && p !== '..'), 'INVALID_PATH', 'Absolute paths, empty segments and traversal are forbidden.');
  ensure(!parts.some(p => ['.git', '.agent-cli.lock'].includes(p) || p.startsWith('.agent-cli-tmp-')), 'INVALID_PATH', 'Reserved workspace path.');
  return input;
}

export const nativeFormats = {
  markdown: ['md'], canvas: ['canvas'], base: ['base'],
  image: ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'],
  audio: ['flac', 'm4a', 'mp3', 'ogg', 'wav', 'webm', '3gp'],
  video: ['mkv', 'mov', 'mp4', 'ogv', 'webm'], pdf: ['pdf'],
} as const;
export function fileKind(path: string): string {
  const ext = path.split('.').at(-1)?.toLowerCase() ?? '';
  return Object.entries(nativeFormats).find(([, extensions]) => (extensions as readonly string[]).includes(ext))?.[0] ?? 'attachment';
}
export const isStructured = (path: string) => ['markdown', 'canvas', 'base'].includes(fileKind(path));

export interface FileSnapshot { path: string; bytes: Uint8Array; revision: string }
export interface WriteRequest { path: string; bytes: Uint8Array; expectedRevision?: string }
export interface FileChange { path: string; revision: string; operation: 'created' | 'updated'; bytes: number }
