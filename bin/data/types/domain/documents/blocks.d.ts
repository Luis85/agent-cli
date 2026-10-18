import type { CachedMetadata } from '../metadata/cache.ts';
import { type RangeEditMode } from './sections.ts';
/**
 * Edits the block that `^id` names, so that the id keeps naming it. A paragraph ending with the marker, or a table,
 * list, quote or other section before a line holding only the marker: `replace` swaps the block's text and keeps
 * its marker; `append` adds content after the block (after a marker line that follows it) and `prepend` before it,
 * both separated by blank lines so the content stays its own block. List items follow `editListItem`.
 */
export declare function editBlock(text: string, metadata: CachedMetadata, id: string, mode: RangeEditMode, content: string): string;
