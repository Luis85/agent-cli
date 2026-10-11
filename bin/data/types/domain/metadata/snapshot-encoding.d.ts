import type { CachedMetadata } from './cache.ts';
import type { LinkResolution } from './link-resolution.ts';
/** What parsing produced for one content revision: the file's metadata, or why the content could not be parsed. */
export type ParseOutcome = {
    metadata: CachedMetadata;
} | {
    issue: {
        code: string;
        message: string;
    };
};
/**
 * A parse outcome as stored. Positions make up most of the metadata, so each `position` (and `frontmatterPosition`)
 * is stored as an index into `positions`, which holds six numbers per position: start line, column and offset, then
 * end line, column and offset. That roughly halves the stored size and the time to read it back.
 */
export type StoredOutcome = {
    metadata: Record<string, unknown>;
    positions: number[];
} | {
    issue: {
        code: string;
        message: string;
    };
};
export declare function encodeOutcome(outcome: ParseOutcome): StoredOutcome;
/**
 * The parse outcome of a stored one, decoded in place: decode each stored outcome once. Undefined when a position
 * index is not one of `positions`, so the file is parsed again.
 */
export declare function decodeOutcome(stored: StoredOutcome): ParseOutcome | undefined;
/**
 * One reference's resolution as stored, by the reference's place in the source's ordered references: a vault path
 * index for a file resolved by path, `-1 - index` for one resolved by alias, `null` for an external target, and the
 * link path with the reason for unresolved ones (ambiguous ones add the candidates' path indexes).
 */
export type StoredResolution = number | null | ['missing', string] | ['path' | 'alias', string, ...number[]];
export declare function encodeResolution(resolution: LinkResolution, index: (path: string) => number): StoredResolution;
/** The resolution of a stored one against the vault paths it was stored with; undefined when it is malformed. */
export declare function decodeResolution(stored: StoredResolution, paths: readonly string[]): LinkResolution | undefined;
