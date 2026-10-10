import { ensure } from '../../../domain/shared/errors.ts';
import { vaultPath } from '../../../domain/documents/file.ts';

export interface BasesQueryOptions { view?: string; context?: string; limit?: number }
/**
 * A note the index read with less than its full metadata; the query still evaluates every file. `unparseable-note`:
 * the note cannot be parsed (for example duplicate frontmatter keys or an unclosed flow sequence) and is indexed
 * without properties, links or tags. `ambiguous-link`: a link path matches several files and resolves to the
 * closest one, `resolvedPath`.
 */
export type BaseIndexWarning =
  | { code: 'unparseable-note'; path: string; message: string }
  | { code: 'ambiguous-link'; path: string; message: string; link: string; candidates: string[]; resolvedPath: string };
export interface BasesQueryResult {
  path: string;
  view: string;
  context: string;
  files: string[];
  total: number;
  /** Indexing warnings over every file of the scope, in vault path order. */
  warnings: BaseIndexWarning[];
  compatibility: Record<string, unknown>;
}
export interface BasesQueryEngine {
  query(path: string, options: BasesQueryOptions): Promise<BasesQueryResult>;
  capabilities(): Record<string, unknown>;
}
export class Bases {
  constructor(private readonly engine: BasesQueryEngine) {}
  capabilities(): Record<string, unknown> { return this.engine.capabilities(); }
  async query(path: string, options: BasesQueryOptions = {}): Promise<BasesQueryResult> {
    path = vaultPath(path);
    ensure(path.endsWith('.base'), 'INVALID_BASE', 'A repository definition must be a native .base file.');
    ensure(options.limit === undefined || (Number.isSafeInteger(options.limit) && options.limit >= 0), 'INVALID_BASE_QUERY', 'Query limit must be a nonnegative safe integer.');
    ensure(options.view === undefined || options.view.trim().length > 0, 'INVALID_BASE_QUERY', 'View name cannot be empty.');
    const context = options.context === undefined ? path : vaultPath(options.context);
    return this.engine.query(path, { ...options, context });
  }
}
