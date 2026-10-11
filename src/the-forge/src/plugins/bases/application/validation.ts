import type { DocumentCodec, FileRepository } from '../../../application/workspace/ports.ts';
import { AppError, errorMessage } from '../../../domain/shared/errors.ts';

/** One reason `bases query` would reject a `.base` file before evaluating it; `view` names the view it belongs to. */
export interface BaseDefinitionIssue { code: string; message: string; view?: string }

/**
 * The `bases.validation` service: the static checks of one `.base` file in the caller's command scope. Structure
 * comes from the document codec (`INVALID_BASE`, `INVALID_YAML`, `INVALID_ENCODING`); `definitionIssues` adds the
 * expression, view, sort and grouping checks of the query engine. A missing file still fails with NOT_FOUND.
 */
export async function validateBaseFile(
  files: FileRepository, codec: DocumentCodec, definitionIssues: (base: Record<string, unknown>) => BaseDefinitionIssue[], path: string,
): Promise<BaseDefinitionIssue[]> {
  const { bytes } = await files.read(path);
  let base: Record<string, unknown>;
  try { base = (codec.inspect(path, bytes) as { data: Record<string, unknown> }).data; }
  catch (error) { return [{ code: error instanceof AppError ? error.code : 'INVALID_BASE', message: errorMessage(error) }]; }
  return definitionIssues(base);
}
