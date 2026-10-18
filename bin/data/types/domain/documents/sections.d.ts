import type { CachedMetadata } from '../metadata/cache.ts';
/** How a section or block edit places `content`: instead of the existing text, after it or before it. */
export type RangeEditMode = 'replace' | 'append' | 'prepend';
export declare const rangeEditModes: readonly RangeEditMode[];
/** The file's line terminator, from its first line break; LF when it has none. */
export declare function lineBreak(text: string): string;
/** Offset of the start of the line that contains `offset`. */
export declare const lineStart: (text: string, offset: number) => number;
/** Offset just after the line that contains `offset` (after its terminator), or the text length on the last line. */
export declare function nextLine(text: string, offset: number): number;
/** Content as whole lines in the file's line ending: every break becomes `newline`, and a final one is added. */
export declare function asLines(content: string, newline: string): string;
/** Inserts whole lines at a line start, first ending an unterminated last line. */
export declare function insertLines(text: string, at: number, content: string, newline: string): string;
/**
 * Edits the section body under a heading. The heading line stays. Its content is the text after the blank lines
 * that follow the heading and before the blank lines that precede the next heading: `replace` swaps it, `append`
 * adds lines after it and `prepend` before it, keeping those blank lines. Content is inserted as whole lines.
 */
export declare function editSection(text: string, metadata: CachedMetadata, heading: string, mode: RangeEditMode, content: string, line?: number): string;
