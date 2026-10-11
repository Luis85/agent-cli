import { type CachedMetadata } from '../../domain/metadata/cache.ts';
import { type TextEdit } from '../../domain/metadata/link-text.ts';
import type { MetadataCache } from '../metadata/ports.ts';
import type { DocumentCodec, YamlStringReplacement } from '../workspace/ports.ts';
/** A reference the planner could not rewrite safely, such as a frontmatter value whose YAML spelling differs from its link text. */
export interface UnrewrittenLink {
    source: string;
    original: string;
    reason: string;
}
/** One file's planned link updates: body edits by offset, link replacements in frontmatter values by key, and Canvas file node values by node id. */
export interface FileLinkPlan {
    source: string;
    edits: TextEdit[];
    frontmatter: YamlStringReplacement[];
    canvas: Array<{
        node: string;
        original: string;
        file: string;
    }>;
}
export interface LinkPlan {
    files: FileLinkPlan[];
    references: number;
    unrewritten: UnrewrittenLink[];
}
/**
 * Plans every link update that a set of path moves needs. A resolved reference is rewritten when, after the move,
 * its unchanged text would no longer resolve to the same (moved) file: a renamed target, a relative path from a
 * moved source, or a bare name the move made ambiguous. Canvas file nodes, which Obsidian opens by exact path,
 * follow every move of their file. References that still resolve, unresolved references,
 * aliases and external URLs stay untouched. Paths are relative to the cache root; `moves` maps old to new paths.
 */
export declare function planLinkUpdates(cache: MetadataCache, moves: ReadonlyMap<string, string>): LinkPlan;
/**
 * Applies one file's planned updates to its decoded text (BOM included, as cache offsets count it). Body edits
 * replace exact offsets; frontmatter links are replaced inside their YAML values through `replaceInYaml`, which
 * re-serializes each changed value in its own quoting style; Canvas file nodes are replaced in their JSON string
 * values, falling back to re-serializing the Canvas. Returns undefined when the body no longer matches the cache,
 * and lists the links it could not rewrite.
 */
export declare function rewriteText(plan: FileLinkPlan, text: string, metadata: CachedMetadata, replaceInYaml: DocumentCodec['replaceInYamlStrings']): {
    text: string;
    unrewritten: UnrewrittenLink[];
} | undefined;
