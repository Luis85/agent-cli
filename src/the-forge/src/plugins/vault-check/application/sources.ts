import type { MetadataCache, MetadataIndex } from '../../../application/metadata/ports.ts';
import type { FileRepository } from '../../../application/workspace/ports.ts';
import { AppError } from '../../../domain/shared/errors.ts';
import type { CachedMetadata } from '../../../domain/metadata/cache.ts';
import { typeRegistry, type TypeRegistry } from '../domain/property-types.ts';

/** One reason a `.base` file is invalid, as the `bases.validation` service reports it. */
export interface BaseIssue { code: string; message: string; view?: string }
/** The `bases.validation` service of the `bases` core plugin, bound to the command scope. */
export interface BaseValidator { validate(path: string): Promise<readonly BaseIssue[]> }

/** What the plugin reads in one command scope: the metadata cache, file text and sizes, and Base validation. */
export interface VaultSources {
  cache(): Promise<MetadataCache>;
  /** A file's UTF-8 text, or null when it does not exist. Dot-prefixed paths such as `.obsidian/types.json` are readable. */
  text(path: string): Promise<string | null>;
  /** A file's size in bytes. */
  size(path: string): Promise<number>;
  /** Null when no enabled plugin provides `bases.validation`. */
  bases: BaseValidator | null;
}

/** The sources of one command scope over its repository and metadata index. */
export function scopeSources(files: FileRepository, metadata: MetadataIndex, bases: BaseValidator | null): VaultSources {
  return {
    cache: () => metadata.load(),
    async text(path) {
      try { return new TextDecoder().decode((await files.read(path)).bytes); }
      catch (error) {
        if (error instanceof AppError && error.code === 'NOT_FOUND') return null;
        throw error;
      }
    },
    async size(path) {
      const stat = await files.stat(path);
      return stat.kind === 'file' ? stat.bytes : 0;
    },
    bases,
  };
}

/** Obsidian's property type registry of the vault root. */
export const typesFile = '.obsidian/types.json';
export const readTypeRegistry = async (sources: VaultSources): Promise<TypeRegistry> => typeRegistry(await sources.text(typesFile));

/** A 1-based location, or null for a file-level finding. */
export interface Location { line: number | null; column: number | null }

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Locates frontmatter keys and values in Markdown text for findings the metadata cache has no position for, reading
 * each note at most once. `key` is a dotted property path (`related.0`); its top-level key names the line.
 */
export class FrontmatterLocator {
  private readonly lines = new Map<string, Promise<string[]>>();
  constructor(private readonly sources: Pick<VaultSources, 'text'>) {}

  async locate(path: string, cache: CachedMetadata, key: string, text?: string): Promise<Location> {
    const block = cache.frontmatterPosition;
    if (!block) return { line: null, column: null };
    if (!this.lines.has(path)) this.lines.set(path, this.sources.text(path).then(content => (content ?? '').split(/\r\n|\r|\n/)));
    const lines = await this.lines.get(path)!;
    const top = key.split('.')[0]!, keyLine = new RegExp(`^(["']?)${escape(top)}\\1\\s*:`);
    let line = block.start.line + 1;
    while (line < block.end.line && !keyLine.test(lines[line] ?? '')) line++;
    if (line >= block.end.line) return { line: block.start.line + 1, column: 1 };
    if (text !== undefined) {
      for (let candidate = line; candidate < block.end.line; candidate++) {
        const column = (lines[candidate] ?? '').indexOf(text);
        if (column >= 0) return { line: candidate + 1, column: column + 1 };
        if (candidate > line && /^\S/.test(lines[candidate] ?? '')) break;
      }
    }
    return { line: line + 1, column: 1 + /^\s*/.exec(lines[line] ?? '')![0].length };
  }
}
