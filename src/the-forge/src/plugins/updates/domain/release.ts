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
