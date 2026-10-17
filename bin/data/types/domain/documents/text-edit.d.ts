import type { CachedMetadata } from '../metadata/cache.ts';
import { type LiteralEdit } from './literal-edit.ts';
import { type RangeEditMode } from './sections.ts';
/**
 * One in-memory edit of a UTF-8 file, shared by the `edit` command and `apply` plans: one literal replacement,
 * ordered literal edits, an append to the end of the file, or a replace, append or prepend inside a Markdown section
 * or block.
 */
export type TextEditRequest = {
    kind: 'replace';
    find: string;
    replace: string;
} | {
    kind: 'literal';
    edits: readonly LiteralEdit[];
} | {
    kind: 'append';
    content: string;
} | {
    kind: 'section';
    section: string;
    line?: number;
    mode: RangeEditMode;
    content: string;
} | {
    kind: 'block';
    block: string;
    mode: RangeEditMode;
    content: string;
};
/** Whether the request needs the note's headings and blocks, and therefore Markdown. */
export declare const targetsStructure: (request: TextEditRequest) => request is {
    kind: "section";
    section: string;
    line?: number;
    mode: RangeEditMode;
    content: string;
} | {
    kind: "block";
    block: string;
    mode: RangeEditMode;
    content: string;
};
/** Applies the request to `text`; `metadata` parses the same text and is called only for section and block edits. */
export declare function applyTextEdit(text: string, request: TextEditRequest, metadata: () => CachedMetadata): string;
