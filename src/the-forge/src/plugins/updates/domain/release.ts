import { codedError } from '../../../domain/shared/errors.ts';
import { vaultPath } from '../../../domain/documents/file.ts';
export interface DistributionPolicy { schemaVersion: number; requiredAssets: string[]; ownedAssetPattern: string }

export type UpdateCode = 'UPDATE_DOWNLOAD_FAILED' | 'UPDATE_INVALID' | 'UPDATE_SCOPE_INVALID';
export function updateError(code: UpdateCode, message: string) { return codedError(code, message, code === 'UPDATE_DOWNLOAD_FAILED' ? 1 : 2); }
export function requireUpdate(condition: unknown, message: string): asserts condition {
  if (!condition) throw updateError('UPDATE_INVALID', message);
}
export function releaseJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw updateError('UPDATE_INVALID', 'A release package or distribution manifest is not valid UTF-8 JSON.'); }
}
export function releaseVersion(value: string): string {
  requireUpdate(/^\d+\.\d+\.\d+$/.test(value), 'Use a stable release version such as 0.1.0.');
  return value;
}
/** Bounds on an archive's listing before extraction: a valid release unpacks to about 20 MB in 400 entries. */
export const archiveLimits = { bytes: 256 * 1024 * 1024, entries: 5_000 };
/**
 * Checks the verbose `tar -tvzf` listing of a release archive before it is extracted: every entry is a regular file
 * or folder, and the entry count and the sum of the declared sizes stay within `archiveLimits`, so a decompression
 * bomb (or a sparse entry claiming terabytes) is refused. GNU tar prints `mode owner/group size date time name`,
 * bsdtar (macOS, Windows) `mode links owner group size date name`; a line in neither form is refused.
 */
export function requireArchiveListing(listing: string): void {
  const lines = listing.trim().split(/\r?\n/);
  requireUpdate(lines.length <= archiveLimits.entries, `Release archive has more than ${archiveLimits.entries} entries.`);
  let total = 0;
  for (const line of lines) {
    requireUpdate(['-', 'd'].includes(line[0]!), 'Release archive contains a link or special file.');
    const fields = line.trim().split(/\s+/);
    const size = fields[1]?.includes('/') ? fields[2] : fields[4];
    requireUpdate(size !== undefined && /^\d+$/.test(size), 'Release archive listing could not be read.');
    total += Number(size);
  }
  requireUpdate(total <= archiveLimits.bytes, `Release archive unpacks to more than ${archiveLimits.bytes / 1024 / 1024} MB.`);
}
export function compareVersions(left: string, right: string): number {
  const a = releaseVersion(left).split('.').map(Number), b = releaseVersion(right).split('.').map(Number);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1;
  return 0;
}
export function distributionFiles(value: unknown, policy: DistributionPolicy): string[] {
  requireUpdate(value !== null && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === policy.schemaVersion && 'files' in value && Array.isArray(value.files), 'The distribution manifest is invalid.');
  const files: unknown[] = value.files;
  const owned = new RegExp(policy.ownedAssetPattern);
  requireUpdate(files.every(path => typeof path === 'string' && owned.test(path)), 'The distribution manifest includes mutable or unowned files.');
  const paths = files as string[];
  for (const path of paths) vaultPath(path);
  requireUpdate(new Set(paths).size === paths.length && policy.requiredAssets.every(path => paths.includes(path)), 'The distribution manifest omits required assets or contains duplicates.');
  return [...paths].sort();
}
