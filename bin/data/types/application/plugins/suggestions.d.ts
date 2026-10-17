/**
 * Did-you-mean suggestions for an unknown command, action or option: close spellings by edit distance, plus the
 * names agents bring from shells and other CLIs (`ls`, `cat`, `rm`, `--force`). Every suggestion is a registered
 * id or an accepted option, so following it never trades one unknown name for another.
 */
/** The unknown names that ask to bypass the revision guard; guidance explains `--if-match` for them. */
export declare const forceOptions: readonly string[];
/** The unknown commands that ask for a copy, which Forge does as a read followed by a create. */
export declare const copyCommands: readonly string[];
/** Suggestions for an unknown command id among the registered `ids`; `version` is answered with `--version`. */
export declare function commandSuggestions(id: string, ids: readonly string[]): string[];
/** Suggestions for an unknown action of a command among its declared `actions`. */
export declare function actionSuggestions(action: string, actions: readonly string[]): string[];
/**
 * Suggestions for an unknown option token (`--secton`, `-y`) among the option names the invocation `accepts`,
 * written as flags. A command option is never answered with an option the command cannot take.
 */
export declare function optionSuggestions(token: string, accepts: readonly string[]): string[];
