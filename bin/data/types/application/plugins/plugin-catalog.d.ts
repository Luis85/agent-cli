import { type ErrorCategory } from '../../domain/shared/error-catalog.ts';
export type Language = 'en' | 'de';
/** Localized text a plugin contributes for its own commands, generators, events, error codes and messages. */
export interface PluginStringTable {
    commands?: Record<string, string>;
    generators?: Record<string, string>;
    events?: Record<string, string>;
    errors?: Record<string, {
        summary: string;
        hint: string;
    }>;
    /** Free-form guidance a plugin reads back through `context.t(key)`. */
    messages?: Record<string, string>;
}
export type PluginStrings = Partial<Record<Language, PluginStringTable>>;
/** A plugin-defined failure code with the same fields as a built-in catalog entry. */
export interface PluginErrorDefinition {
    code: string;
    category: ErrorCategory;
    summary: string;
    hint: string;
    retryable?: boolean;
}
export interface CatalogedError {
    pluginId: string;
    code: string;
    exitCode: number;
    category: ErrorCategory;
    summary: string;
    hint: string;
    retryable: boolean;
}
type TextKind = 'commands' | 'generators' | 'events';
interface Owned {
    commands: readonly string[];
    generators: readonly string[];
    events: readonly string[];
}
/** The plugin-contributed localization and error catalog that the kernel catalogs fall back to. */
export declare class PluginCatalog {
    private readonly tables;
    private readonly codes;
    /** Validates one plugin's contributions; `prefix` restricts user plugin codes to `<ID>_…`. */
    static validate(pluginId: string, strings: unknown, errors: unknown, owned: Owned, prefix: string | null): void;
    add(pluginId: string, strings: PluginStrings | undefined, errors: readonly PluginErrorDefinition[] | undefined): void;
    /** Contributed text for a command, generator or event id in `language`, if any. */
    text(language: Language, kind: TextKind, id: string): string | undefined;
    /** A plugin message in `language`, falling back to English and then to the key itself. */
    message(pluginId: string, language: Language, key: string): string;
    error(code: string): CatalogedError | undefined;
    localizedError(code: string, language: Language): {
        summary: string;
        hint: string;
    } | undefined;
    errors(): CatalogedError[];
    /**
     * Plugin code cannot construct host errors, so it throws an `Error` with a registered `code` (and optional
     * `details`). This turns it into a coded failure with the category's exit status; anything else is unchanged.
     */
    normalize(error: unknown): unknown;
}
export {};
