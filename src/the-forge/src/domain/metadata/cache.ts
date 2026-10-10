/**
 * Obsidian-shaped, JSON-serializable file metadata. Field names and meanings follow Obsidian's
 * `CachedMetadata`; Forge additions (`syntax`, `subpath`, `reference`, `embed`, `canvasLinks`, `aliases`)
 * carry what headless link maintenance needs and are documented in docs/reference/formats.md.
 */

/** A zero-based location in the decoded file text, including any BOM and the frontmatter block. */
export interface Loc { line: number; col: number; offset: number }
export interface Pos { start: Loc; end: Loc }
export interface CacheItem { position: Pos }

/** `link` is the link text without display text, such as `Note#Heading`; `original` is the source text. */
export interface Reference { link: string; original: string; displayText?: string }
/** Wikilinks and Canvas paths resolve from the vault; Markdown, reference and HTML targets resolve from the source folder. */
export type LinkSyntax = 'wikilink' | 'markdown' | 'reference' | 'html' | 'canvas';
interface LinkTarget extends Reference {
  syntax: LinkSyntax;
  /** The `#Heading` or `#^block` part of `link`, when present. */
  subpath?: string;
}
/** A body link or embed. Reference-style uses (`[text][id]`) name their definition in `reference`. */
export interface LinkCache extends LinkTarget, CacheItem { reference?: string }
export type EmbedCache = LinkCache;
/** A link found in a frontmatter string; `key` is the dotted property path, with list indexes. */
export interface FrontmatterLinkCache extends LinkTarget { key: string; embed?: true }
/** A Markdown reference definition such as `[id]: ../Note.md`; uses appear in `links` or `embeds`. */
export interface ReferenceLinkCache extends Reference, CacheItem { id: string }
/** A Canvas `file` node; `node` is the node id. */
export interface CanvasLinkCache extends LinkTarget { node: string }
export interface TagCache extends CacheItem { tag: string }
export interface HeadingCache extends CacheItem { heading: string; level: number }
export interface BlockCache extends CacheItem { id: string }
export interface SectionCache extends CacheItem { type: string; id?: string }
/** `parent` is the parent item's start line, or the negated first line of a top-level list. */
export interface ListItemCache extends CacheItem { parent: number; task?: string; id?: string }

export interface CachedMetadata {
  links?: LinkCache[];
  embeds?: EmbedCache[];
  frontmatterLinks?: FrontmatterLinkCache[];
  referenceLinks?: ReferenceLinkCache[];
  canvasLinks?: CanvasLinkCache[];
  tags?: TagCache[];
  headings?: HeadingCache[];
  blocks?: Record<string, BlockCache>;
  sections?: SectionCache[];
  listItems?: ListItemCache[];
  frontmatter?: Record<string, unknown>;
  frontmatterPosition?: Pos;
  aliases?: string[];
}

/** Splits link text into its path and `#` subpath, as Obsidian's `parseLinktext` does. */
export function parseLinktext(link: string): { path: string; subpath: string } {
  const hash = link.indexOf('#');
  return hash < 0 ? { path: link, subpath: '' } : { path: link.slice(0, hash), subpath: link.slice(hash) };
}

/** Obsidian's default display text for a link without an alias, such as `Note > Heading`. */
export function defaultDisplayText(link: string): string {
  const { path, subpath } = parseLinktext(link);
  const parts = subpath.split('#').filter(Boolean);
  return [path, ...parts].filter(Boolean).join(' > ');
}

function stringList(value: unknown, split: RegExp): string[] {
  if (typeof value === 'string') return value.split(split);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Frontmatter `tags` (or `tag`) as `#tag` strings, accepting a list or a comma/space separated string. */
function frontmatterTags(frontmatter: Record<string, unknown> | undefined): string[] {
  const value = frontmatter?.tags ?? frontmatter?.tag;
  return stringList(value, /[,\s]+/).filter(tag => tag.length > 0).map(tag => '#' + tag.replace(/^#/, ''));
}

/** Frontmatter `aliases` (or `alias`), accepting a list or a comma-separated string. */
export function frontmatterAliases(frontmatter: Record<string, unknown> | undefined): string[] {
  const value = frontmatter?.aliases ?? frontmatter?.alias;
  return stringList(value, /,/).map(alias => alias.trim()).filter(alias => alias.length > 0);
}

/** Inline tags followed by frontmatter tags, without duplicates, like Obsidian's `getAllTags`. */
export function allTags(cache: CachedMetadata | null): string[] {
  if (!cache) return [];
  return [...new Set([...(cache.tags ?? []).map(item => item.tag), ...frontmatterTags(cache.frontmatter)])];
}
