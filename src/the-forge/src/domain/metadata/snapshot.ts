import { isRecord } from '../shared/errors.ts';
import { fileKind } from '../documents/file.ts';
import type { StoredOutcome, StoredResolution } from './snapshot-encoding.ts';

/** The layout version of a stored metadata snapshot; a snapshot of another layout is ignored. */
export const snapshotFormat = 2;

/**
 * How long after a listing a file's timestamps stay too recent to trust (git's "racy clean" rule). A file changed
 * within the same timestamp tick as a read could keep its stamp, so files whose last modification or status change
 * lies within this window of the listing are re-read. Two seconds covers FAT's mtime resolution and small clock skew.
 */
export const racyWindowMs = 2000;

/**
 * One indexed file as last seen. `stamp` describes the file's filesystem state taken before its content was read,
 * or is null when the content was read without one (after a commit), so the next load re-reads it.
 */
export interface SnapshotFile { stamp: string | null; revision: string }

/**
 * The link resolution of a stored index: its vault paths in index order, `aliases`, a key of every note's aliases
 * (`aliasesKey`), and each parsed source's resolutions in the order of its references. Resolution depends only on
 * the paths, the aliases and the source's own content, so it is reused only while all three are unchanged.
 */
export interface StoredLinks { paths: string[]; aliases: string; sources: Record<string, StoredResolution[]> }

/**
 * The parse results of one scope's vault, stored between invocations. `key` names the Forge build, parser and scope
 * the results belong to; `checkedAtMs` is when the stamps were taken; `outcomes` are keyed by `outcomeKey`; `links`
 * is the link resolution of the stored index. Backlinks and link counts are always recomputed from it.
 */
export interface MetadataSnapshot {
  format: typeof snapshotFormat;
  key: string;
  checkedAtMs: number;
  files: Record<string, SnapshotFile>;
  outcomes: Record<string, StoredOutcome>;
  links: StoredLinks | null;
}

/** The key of every note's aliases for `StoredLinks`, from the alias map the link index is built with. */
export const aliasesKey = (aliases: ReadonlyMap<string, readonly string[]>) => JSON.stringify([...aliases]);

/** A file's current filesystem stamp and the later of its modification and status-change times. */
export interface FileStamp { stamp: string; changedMs: number }

/**
 * The key of a parse outcome. Parsing depends only on the bytes and the file kind (Markdown or Canvas), so equal
 * content reuses one result under any path: renamed and moved files are not parsed again.
 */
export const outcomeKey = (path: string, revision: string) => `${fileKind(path)}:${revision}`;

/**
 * Whether a stored file can be reused without reading it: its stamp is unchanged and its last change happened
 * before the racy window of the listing that stored it.
 */
export function unchangedFile(stored: SnapshotFile | undefined, current: FileStamp | undefined, checkedAtMs: number): boolean {
  return stored !== undefined && current !== undefined && stored.stamp !== null && stored.stamp === current.stamp
    && current.changedMs < checkedAtMs - racyWindowMs;
}

const text = (value: unknown): value is string => typeof value === 'string';

function storedLinks(value: unknown): value is StoredLinks {
  return isRecord(value) && Array.isArray(value.paths) && value.paths.every(text) && text(value.aliases)
    && isRecord(value.sources) && Object.values(value.sources).every(Array.isArray);
}

function snapshotFile(value: unknown): value is SnapshotFile {
  return isRecord(value) && (value.stamp === null || text(value.stamp)) && text(value.revision);
}

function storedOutcome(value: unknown): value is StoredOutcome {
  if (!isRecord(value)) return false;
  if (isRecord(value.metadata)) return Array.isArray(value.positions) && Object.keys(value).length === 2;
  return isRecord(value.issue) && text(value.issue.code) && text(value.issue.message) && Object.keys(value).length === 1;
}

/**
 * The stored value as a snapshot for `key`, or null when it has another format or key or any part has the wrong
 * shape: a snapshot is reused completely or not at all.
 */
export function readSnapshot(value: unknown, key: string): MetadataSnapshot | null {
  if (!isRecord(value) || value.format !== snapshotFormat || value.key !== key) return null;
  if (typeof value.checkedAtMs !== 'number' || !Number.isFinite(value.checkedAtMs)) return null;
  if (!isRecord(value.files) || !Object.values(value.files).every(snapshotFile)) return null;
  if (!isRecord(value.outcomes) || !Object.values(value.outcomes).every(storedOutcome)) return null;
  if (value.links !== null && !storedLinks(value.links)) return null;
  return value as unknown as MetadataSnapshot;
}
