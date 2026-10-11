import { type ErrorCategory } from '../../domain/shared/error-catalog.ts';
export type Language = 'en' | 'de';
/** Localized text a plugin contributes for its own commands, generators, events, error codes and messages. */
export interface PluginStringTable {
    commands?: Record<string, string>;
    /** Descriptions of the plugin's command actions, keyed `<command> <action>`. */
    actions?: Record<string, string>;
    generators?: Record<string, string>;
    events?: Record<string, string>;
    errors?: Record<string, {
        summary: string;
        hint: string;
    }>;
    /** Free-form guidance a plugin reads back through `context.t(key)`. */
    messages?: Record<string, string>;
    /**
     * Translations of the plugin's option, argument and settings descriptions, keyed by their English text: `help`,
     * `schema` and `config` show them in this language wherever the plugin declares that text.
     */
    descriptions?: Record<string, string>;
    /** The plugin's manifest `name` and `description` as `plugins` lists them. */
    manifest?: {
        name?: string;
        description?: string;
    };
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
type TextKind = 'commands' | 'actions' | 'generators' | 'events';
interface Owned {
    commands: readonly string[];
    actions: readonly string[];
    generators: readonly string[];
    events: readonly string[];
}
/** A user plugin's error code prefix: its id in UPPER_SNAKE_CASE and `_` (`quality-gate` → `QUALITY_GATE_`). */
export declare const errorPrefix: (pluginId: string) => string;
/** The plugin-contributed localization and error catalog that the kernel catalogs fall back to. */
export declare class PluginCatalog {
    private readonly tables;
    private readonly codes;
    /** Error code prefixes of registered user plugins, by plugin id. */
    private readonly prefixes;
    /** Validates one plugin's contributions; `prefix` restricts user plugin codes to `<ID>_…`. */
    static validate(pluginId: string, strings: unknown, errors: unknown, owned: Owned, prefix: string | null): void;
    /**
     * Checks, before anything registers, that one plugin's codes are new and that user plugin codes stay owned: a
     * code belongs to the registered user plugin with the longest matching prefix, so plugin `a` (`A_`) cannot
     * register `A_B_X` while plugin `a-b` (`A_B_`) is registered, and `a-b` cannot register after `a` registered
     * `A_B_X`. The later plugin fails with PLUGIN_NAMESPACE. `prefix` is null for core plugins.
     */
    ensureRegistrable(pluginId: string, errors: readonly PluginErrorDefinition[] | undefined, prefix: string | null): void;
    /** Registers a plugin that passed `ensureRegistrable` with the same `prefix`. */
    add(pluginId: string, strings: PluginStrings | undefined, errors: readonly PluginErrorDefinition[] | undefined, prefix?: string | null): void;
    /** Contributed text for a command, generator or event id in `language`, if any. */
    text(language: Language, kind: TextKind, id: string): string | undefined;
    /**
     * The translation of an option, argument or settings description in `language`, by its English text. Plugins
     * translate the texts they declare; a text several plugins declare reads the same in each.
     */
    description(language: Language, english: string): string | undefined;
    /** A plugin's localized manifest fields, also for a bundled core plugin that `plugins.disabled` lists. */
    manifest(pluginId: string, language: Language): {
        name?: string;
        description?: string;
    } | undefined;
    /**
     * Records the manifest strings of a bundled core plugin that `plugins.disabled` lists: it contributes nothing,
     * but `plugins` still lists its name and description in the response language.
     */
    addDisabled(pluginId: string, strings: PluginStrings): void;
    /** A plugin message in `language`, falling back to English and then to the key itself. */
    message(pluginId: string, language: Language, key: string): string;
    error(code: string): CatalogedError | undefined;
    localizedError(code: string, language: Language): {
        summary: string;
        hint: string;
    } | undefined;
    errors(): CatalogedError[];
    /**
     * Plugin code cannot construct host errors, so it throws an `Error` with a `code` (and optional `details`). This
     * turns a code that `pluginId` registered itself, or a built-in catalog code, into a coded failure with its
     * category's exit status. A code of one of `providers`, the plugins providing services that `pluginId` declared,
     * maps too, since their failures surface through their consumer's calls. Any other plugin's code stays an uncoded
     * error: a plugin cannot borrow a code it does not own. Anything else is unchanged. An `interrupted` code thrown
     * with `exitCode: 143` (SIGTERM) keeps it.
     */
    normalize(error: unknown, pluginId: string, providers?: readonly string[]): unknown;
}
export {};
