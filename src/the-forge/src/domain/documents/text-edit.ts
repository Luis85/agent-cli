import type { CachedMetadata } from '../metadata/cache.ts';
import { applyLiteralEdits, replaceUniqueLiteral, type LiteralEdit } from './literal-edit.ts';
import { editSection, type RangeEditMode } from './sections.ts';
import { editBlock } from './blocks.ts';

/**
 * One in-memory edit of a UTF-8 file, shared by the `edit` command and `apply` plans: one literal replacement,
 * ordered literal edits, an append to the end of the file, or a replace, append or prepend inside a Markdown section
 * or block.
 */
export type TextEditRequest =
  | { kind: 'replace'; find: string; replace: string }
  | { kind: 'literal'; edits: readonly LiteralEdit[] }
  | { kind: 'append'; content: string }
  | { kind: 'section'; section: string; mode: RangeEditMode; content: string }
  | { kind: 'block'; block: string; mode: RangeEditMode; content: string };

/** Whether the request needs the note's headings and blocks, and therefore Markdown. */
export const targetsStructure = (request: TextEditRequest) => request.kind === 'section' || request.kind === 'block';

/** Applies the request to `text`; `metadata` parses the same text and is called only for section and block edits. */
export function applyTextEdit(text: string, request: TextEditRequest, metadata: () => CachedMetadata): string {
  switch (request.kind) {
    case 'replace': return replaceUniqueLiteral(text, request.find, request.replace);
    case 'literal': return applyLiteralEdits(text, request.edits);
    case 'append': return text + request.content;
    case 'section': return editSection(text, metadata(), request.section, request.mode, request.content);
    case 'block': return editBlock(text, metadata(), request.block, request.mode, request.content);
  }
}
