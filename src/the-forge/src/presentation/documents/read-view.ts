import { ensure, isRecord } from '../../domain/shared/errors.ts';
import { kernelMessage, type KernelMessage } from '../../domain/shared/kernel-messages.ts';
import { textWindow, type LineRange } from '../../domain/documents/text-window.ts';
import type { Workspace } from '../../application/workspace/workspace.ts';

/** Bytes of text or attachment content a read returns per field unless --max-bytes raises it; 32 of them fill read-many's budget. */
export const defaultReadBytes = 256 * 1024;
/** The parts of a Markdown read, in output order; content and properties unless --parts selects others. */
export const markdownParts = ['content', 'properties', 'body'] as const;
const defaultParts: ReadonlySet<string> = new Set(['content', 'properties']);

type ReadResult = Awaited<ReturnType<Workspace['read']>>;
/** What a read returns: Markdown `parts`, the `lines` of text content, and at most `maxBytes` of each text field. */
export interface ReadSelection { parts?: ReadonlySet<string>; lines?: LineRange; maxBytes: number }

/**
 * Shapes one read result. Markdown returns only the selected parts; text content (Markdown `content` and UTF-8
 * text) returns the selected lines up to `maxBytes`, adding `lines` when a range was given or the limit cut it, and
 * `truncated: true` with a warning when the limit cut any field. Base64 content keeps at most `maxBytes` raw
 * bytes. Canvas and Bases data is returned whole. A `--parts` or `--lines` the file kind cannot honour is
 * INVALID_ARGUMENT.
 */
export function readView(result: ReadResult, selection: ReadSelection, warn: (message: KernelMessage) => void) {
  const document: Record<string, unknown> = isRecord(result.document) ? result.document : {};
  const { kind } = document, textual = kind === 'markdown' || kind === 'text';
  ensure(selection.parts === undefined || kind === 'markdown', 'INVALID_ARGUMENT', '--parts requires a Markdown file.');
  ensure(selection.lines === undefined || textual, 'INVALID_ARGUMENT', '--lines requires a Markdown or UTF-8 text file.');
  const cut = (returned: number, bytes: number) => warn(kernelMessage('READ_BYTES_TRUNCATED', { path: result.path, returned, bytes }));
  if (document.encoding === 'base64' && result.bytes > selection.maxBytes) {
    cut(selection.maxBytes, result.bytes);
    const content = Buffer.from(String(document.content), 'base64').subarray(0, selection.maxBytes).toString('base64');
    return { ...result, document: { ...document, content }, truncated: true };
  }
  if (!textual) return result;
  const parts = kind === 'markdown' ? selection.parts ?? defaultParts : new Set(['content']);
  ensure(selection.lines === undefined || parts.has('content'), 'INVALID_ARGUMENT', '--lines selects lines of content; include content in --parts.');
  const shaped: Record<string, unknown> = { kind };
  const extra: { truncated?: true; lines?: ReturnType<typeof textWindow>['lines'] } = {};
  if (parts.has('content')) {
    const window = textWindow(String(document.content), selection.maxBytes, selection.lines);
    shaped.content = window.content;
    if (window.truncated || selection.lines) extra.lines = window.lines;
    if (window.truncated) {
      extra.truncated = true;
      const { start, end, total } = window.lines;
      warn(kernelMessage('READ_TRUNCATED', { path: result.path, start, end, total, returned: window.bytes, bytes: result.bytes, next: window.partial ? end : end + 1 }));
    }
  }
  if (parts.has('properties')) shaped.properties = document.properties;
  if (parts.has('body')) {
    const body = String(document.body), window = textWindow(body, selection.maxBytes);
    shaped.body = window.content;
    if (window.truncated) { extra.truncated = true; cut(window.bytes, Buffer.byteLength(body)); }
  }
  return { ...result, document: shaped, ...extra };
}
