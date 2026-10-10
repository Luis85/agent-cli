import { ensure, forgeError } from '../../domain/shared/errors.ts';
import { fileKind } from '../../domain/documents/file.ts';
import { applyTextEdit, targetsStructure, type TextEditRequest } from '../../domain/documents/text-edit.ts';
import type { MetadataIndex } from '../metadata/ports.ts';

/** UTF-8 text of a file to edit; other bytes are INVALID_ENCODING. */
export function decodeText(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw forgeError('INVALID_ENCODING', 'Edits require valid UTF-8 text; use write for binary content.'); }
}

/** Text edits apply to Markdown and UTF-8 text files; section and block edits only to Markdown notes. */
export function ensureEditable(path: string, request: TextEditRequest): void {
  const kind = fileKind(path);
  ensure(['markdown', 'text'].includes(kind), 'UNSUPPORTED_EDIT', 'Use edit for Markdown and text files, patch for Canvas/Bases, and write for attachments.');
  ensure(!targetsStructure(request) || kind === 'markdown', 'UNSUPPORTED_EDIT', 'Section and block edits require a Markdown note.');
}

/**
 * The bytes after one text edit of Markdown or UTF-8 text. Section and block edits read the note's headings and
 * blocks from the same content through the metadata parser, so positions always match the text.
 */
export function editBytes(path: string, bytes: Uint8Array, request: TextEditRequest, metadata: Pick<MetadataIndex, 'parseContent'>): Uint8Array {
  ensureEditable(path, request);
  const text = decodeText(bytes);
  return new TextEncoder().encode(applyTextEdit(text, request, () => metadata.parseContent(path, bytes)!));
}
