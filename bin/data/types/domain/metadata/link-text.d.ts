import { type LinkIndex } from './link-resolution.ts';
/**
 * Link text for moved files. Each function rewrites only the path of one reference and keeps everything else of
 * its source text: the embed `!`, `#Heading` and `#^block` subpaths, `|display` text, titles, angle brackets,
 * percent-encoding, a leading `/` or `./`, and whether a Markdown target spells its `.md` extension.
 */
/** A replacement of `[start, end)` in a text; `original` is the replaced text, checked before applying. */
export interface TextEdit {
    start: number;
    end: number;
    original: string;
    text: string;
}
/** The POSIX path from a folder (`.` for the root) to a vault path, such as `../Specs/Plan.md`. */
export declare function relativePath(fromFolder: string, to: string): string;
/**
 * A vault-style link path (wikilinks, Canvas-like references) to `target` from `source`. A bare file name stays the
 * shortest unambiguous link text (Obsidian's `fileToLinktext`); a path keeps naming the full vault path.
 */
export declare function vaultLinkpath(index: LinkIndex, previous: string, target: string, source: string): string;
/** The new `[[…]]` or `![[…]]` source text, or undefined when its shape is not a wikilink naming `link`. */
export declare function rewriteWikilink(original: string, link: string, newPath: string): string | undefined;
/** Where a destination sits in a source text, relative to the text's start. */
export interface Destination {
    start: number;
    end: number;
    raw: string;
    angle: boolean;
}
/** The destination of `[text](dest "title")` or `![alt](dest)` source text. */
export declare function markdownDestination(original: string): Destination | undefined;
/** The destination of a reference definition such as `[id]: ../Plan.md "Title"`. */
export declare function definitionDestination(original: string): Destination | undefined;
/** The value of an `href="…"` or `src='…'` attribute text. */
export declare function attributeDestination(original: string): Destination | undefined;
/**
 * A new relative-style destination (Markdown, reference definitions, HTML) for `target`. A destination that
 * resolved as a vault path (with or without a leading `/`) stays vault-absolute; otherwise the path is relative to
 * the source's new folder. The `#` fragment is kept verbatim, and a percent-encoded path stays encoded.
 */
export declare function rewriteDestination(destination: Destination, oldSource: string, oldTarget: string, newSource: string, target: string): string;
/**
 * Applies edits after checking that each still replaces its original text; undefined when one does not. Each edit
 * is narrowed to the characters it changes first, so a reference nested in another one, such as an image inside a
 * link's text or a wikilink in a link label, is rewritten together with it. An edit whose changed characters still
 * overlap an applied edit is left out and returned in `skipped`.
 */
export declare function applyEdits(text: string, edits: readonly TextEdit[]): {
    text: string;
    skipped: TextEdit[];
} | undefined;
