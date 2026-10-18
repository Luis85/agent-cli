/** AMBIGUOUS_EDIT reports at most this many match lines; `matches` always carries the full count. */
export declare const reportedMatchLines = 20;
/** Start offsets of every literal occurrence, including overlapping occurrences. */
export declare function literalMatches(text: string, find: string): number[];
/** Replace the single literal occurrence of `find`; zero or several occurrences are distinct failures. */
export declare function replaceUniqueLiteral(text: string, find: string, replacement: string): string;
/** One literal replacement of a multi-edit: `find` must occur exactly once, or at least once with `all`. */
export interface LiteralEdit {
    find: string;
    replace: string;
    all?: boolean;
}
/**
 * Applies literal edits in order, each to the result of the previous one, entirely in memory. A failing edit
 * keeps its code (NO_MATCH, AMBIGUOUS_EDIT, INVALID_INPUT) and names its 0-based position in `details.edit`.
 */
export declare function applyLiteralEdits(text: string, edits: readonly LiteralEdit[]): string;
