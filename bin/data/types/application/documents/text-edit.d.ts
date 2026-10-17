import { type TextEditRequest } from '../../domain/documents/text-edit.ts';
import type { MetadataIndex } from '../metadata/ports.ts';
/** UTF-8 text of a file to edit; other bytes are INVALID_ENCODING. */
export declare function decodeText(bytes: Uint8Array): string;
/** Text edits apply to Markdown and UTF-8 text files; section and block edits only to Markdown notes. */
export declare function ensureEditable(path: string, request: TextEditRequest): void;
/**
 * The bytes after one text edit of Markdown or UTF-8 text. Section and block edits read the note's headings and
 * blocks from the same content through the metadata parser, so positions always match the text.
 */
export declare function editBytes(path: string, bytes: Uint8Array, request: TextEditRequest, metadata: Pick<MetadataIndex, 'parseContent'>): Uint8Array;
