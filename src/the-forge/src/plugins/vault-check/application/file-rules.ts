import type { MetadataCache, MetadataIssue } from '../../../application/metadata/ports.ts';
import type { CachedMetadata } from '../../../domain/metadata/cache.ts';
import { fileKind } from '../../../domain/documents/file.ts';
import { errorMessage } from '../../../domain/shared/errors.ts';
import type { Detection } from '../domain/rules.ts';
import type { BaseValidator } from './sources.ts';

/** Obsidian attachment kinds: media, PDFs and other files that are neither notes nor UTF-8 text. */
const attachmentKinds = ['image', 'audio', 'video', 'pdf', 'attachment'];
const isAttachment = (path: string) => attachmentKinds.includes(fileKind(path));

/** The first line of a diagnostic, without the source excerpt YAML errors append. */
const firstLine = (message: string) => message.split(/\r?\n/)[0]!.replace(/:\s*$/, '');

/**
 * A note the index could not parse (`invalid-frontmatter`) or an invalid Canvas (`invalid-canvas`). YAML errors name
 * their position inside the frontmatter, which starts on the line after the opening `---`.
 */
export function issueDetection(issue: MetadataIssue): Detection {
  const canvas = fileKind(issue.path) === 'canvas';
  const at = canvas ? null : /at line (\d+), column (\d+)/.exec(issue.message);
  return {
    rule: canvas ? 'invalid-canvas' : 'invalid-frontmatter', path: issue.path,
    line: at ? Number(at[1]) + 1 : null, column: at ? Number(at[2]) : null,
    message: canvas ? 'invalid-canvas' : 'invalid-frontmatter', params: { code: issue.code, reason: firstLine(issue.message) },
  };
}

/** Block ids repeated in one note (`^id`, compared without case); each repeat names the line of the first use. */
export function duplicateBlockIds(path: string, cache: CachedMetadata): Detection[] {
  const ids = [...(cache.sections ?? []), ...(cache.listItems ?? [])]
    .flatMap(item => item.id === undefined ? [] : [{ id: item.id, start: item.position.start }])
    .sort((a, b) => a.start.offset - b.start.offset);
  const first = new Map<string, number>();
  return ids.flatMap(({ id, start }) => {
    const seen = first.get(id.toLowerCase());
    if (seen === undefined) { first.set(id.toLowerCase(), start.line + 1); return []; }
    return [{ rule: 'duplicate-block-id' as const, path, line: start.line + 1, column: start.col + 1, message: 'duplicate-block-id', params: { id, first: seen } }];
  });
}

/** A parsed note with neither frontmatter nor body content (whitespace and `%%comments%%` only), or a zero-byte file. */
export async function isEmpty(path: string, cache: MetadataCache, size: (path: string) => Promise<number>): Promise<boolean> {
  if (fileKind(path) === 'markdown') {
    const parsed = cache.getFileCache(path);
    return parsed !== null && (parsed.sections ?? []).length === 0;
  }
  return await size(path) === 0;
}

/** An attachment that no file links to, embeds, names in a property or places on a Canvas. */
export const isOrphanAttachment = (path: string, cache: MetadataCache) => isAttachment(path) && cache.backlinks(path).length === 0;

/** Each problem the `bases.validation` service reports for one `.base` file; a failing service call is one finding. */
export async function baseDetections(path: string, bases: BaseValidator): Promise<Detection[]> {
  let issues;
  try { issues = await bases.validate(path); }
  catch (error) { issues = [{ code: 'INVALID_BASE', message: errorMessage(error) }]; }
  return issues.map(issue => ({
    rule: 'invalid-base' as const, path, line: null, column: null,
    message: issue.view === undefined ? 'invalid-base' : 'invalid-base.view',
    params: { code: issue.code, reason: firstLine(issue.message), view: issue.view ?? '' },
  }));
}
