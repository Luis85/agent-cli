import { ensure } from '../domain/errors.ts';
import { vaultPath } from '../domain/file.ts';

export interface BasesQueryOptions { view?: string; context?: string; limit?: number }
export interface BasesQueryResult {
  path: string;
  view: string;
  context: string;
  files: string[];
  total: number;
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
