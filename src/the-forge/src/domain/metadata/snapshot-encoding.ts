import type { CachedMetadata, Pos } from './cache.ts';
import type { LinkResolution } from './link-resolution.ts';

/** What parsing produced for one content revision: the file's metadata, or why the content could not be parsed. */
export type ParseOutcome = { metadata: CachedMetadata } | { issue: { code: string; message: string } };

/**
 * A parse outcome as stored. Positions make up most of the metadata, so each `position` (and `frontmatterPosition`)
 * is stored as an index into `positions`, which holds six numbers per position: start line, column and offset, then
 * end line, column and offset. That roughly halves the stored size and the time to read it back.
 */
export type StoredOutcome = { metadata: Record<string, unknown>; positions: number[] } | { issue: { code: string; message: string } };

/** The `CachedMetadata` lists whose items carry a `position`. */
const positioned = ['links', 'embeds', 'referenceLinks', 'tags', 'headings', 'sections', 'listItems'] as const;

export function encodeOutcome(outcome: ParseOutcome): StoredOutcome {
  if (!('metadata' in outcome)) return outcome;
  const positions: number[] = [];
  const index = ({ start, end }: Pos) => positions.push(start.line, start.col, start.offset, end.line, end.col, end.offset) / 6 - 1;
  const source = outcome.metadata, metadata: Record<string, unknown> = { ...source };
  for (const key of positioned) {
    const items = source[key];
    if (items) metadata[key] = items.map(item => ({ ...item, position: index(item.position) }));
  }
  if (source.blocks) metadata.blocks = Object.fromEntries(Object.entries(source.blocks).map(([id, block]) => [id, { ...block, position: index(block.position) }]));
  if (source.frontmatterPosition) metadata.frontmatterPosition = index(source.frontmatterPosition);
  return { metadata, positions };
}

/**
 * The parse outcome of a stored one, decoded in place: decode each stored outcome once. Undefined when a position
 * index is not one of `positions`, so the file is parsed again.
 */
export function decodeOutcome(stored: StoredOutcome): ParseOutcome | undefined {
  if (!('metadata' in stored)) return stored;
  const { metadata, positions } = stored;
  if (!Array.isArray(positions) || positions.length % 6 !== 0) return undefined;
  const count = positions.length / 6;
  const position = (value: unknown): Pos | undefined => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= count) return undefined;
    const at = value * 6;
    return { start: { line: positions[at]!, col: positions[at + 1]!, offset: positions[at + 2]! }, end: { line: positions[at + 3]!, col: positions[at + 4]!, offset: positions[at + 5]! } };
  };
  const decode = (item: { position?: unknown }) => {
    const value = position(item.position);
    if (value === undefined) return false;
    item.position = value;
    return true;
  };
  for (const key of positioned) {
    const items = metadata[key];
    if (items !== undefined && !(Array.isArray(items) && items.every(decode))) return undefined;
  }
  const blocks = metadata.blocks as Record<string, { position?: unknown }> | undefined;
  if (blocks !== undefined && !Object.values(blocks).every(decode)) return undefined;
  if (metadata.frontmatterPosition !== undefined) {
    const value = position(metadata.frontmatterPosition);
    if (value === undefined) return undefined;
    metadata.frontmatterPosition = value;
  }
  return { metadata: metadata as unknown as CachedMetadata };
}

/**
 * One reference's resolution as stored, by the reference's place in the source's ordered references: a vault path
 * index for a file resolved by path, `-1 - index` for one resolved by alias, `null` for an external target, and the
 * link path with the reason for unresolved ones (ambiguous ones add the candidates' path indexes).
 */
export type StoredResolution = number | null | ['missing', string] | ['path' | 'alias', string, ...number[]];

export function encodeResolution(resolution: LinkResolution, index: (path: string) => number): StoredResolution {
  if (resolution.status === 'external') return null;
  if (resolution.status === 'resolved') return resolution.via === 'path' ? index(resolution.path) : -1 - index(resolution.path);
  if (resolution.reason === 'missing') return ['missing', resolution.linkpath];
  return [resolution.via, resolution.linkpath, ...resolution.candidates.map(index)];
}

/** The resolution of a stored one against the vault paths it was stored with; undefined when it is malformed. */
export function decodeResolution(stored: StoredResolution, paths: readonly string[]): LinkResolution | undefined {
  const path = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < paths.length ? paths[value] : undefined;
  if (stored === null) return { status: 'external' };
  if (typeof stored === 'number') {
    const resolved = path(stored < 0 ? -1 - stored : stored);
    return resolved === undefined ? undefined : { status: 'resolved', path: resolved, via: stored < 0 ? 'alias' : 'path' };
  }
  if (!Array.isArray(stored) || typeof stored[1] !== 'string') return undefined;
  const [reason, linkpath, ...indexes] = stored;
  if (reason === 'missing') return stored.length === 2 ? { status: 'unresolved', linkpath, reason } : undefined;
  if (reason !== 'path' && reason !== 'alias') return undefined;
  const candidates = indexes.map(path);
  return candidates.length > 1 && candidates.every(item => item !== undefined)
    ? { status: 'unresolved', linkpath, reason: 'ambiguous', via: reason, candidates: candidates as string[] } : undefined;
}
