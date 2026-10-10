import { categoryExitCodes, errorDefinition, type ErrorCategory } from '../../domain/shared/error-catalog.ts';
import { AppError, codedError, ensure, isRecord } from '../../domain/shared/errors.ts';

export type Language = 'en' | 'de';
const languages: readonly Language[] = ['en', 'de'];
/** Localized text a plugin contributes for its own commands, generators, events, error codes and messages. */
export interface PluginStringTable {
  commands?: Record<string, string>;
  /** Descriptions of the plugin's command actions, keyed `<command> <action>`. */
  actions?: Record<string, string>;
  generators?: Record<string, string>;
  events?: Record<string, string>;
  errors?: Record<string, { summary: string; hint: string }>;
  /** Free-form guidance a plugin reads back through `context.t(key)`. */
  messages?: Record<string, string>;
}
export type PluginStrings = Partial<Record<Language, PluginStringTable>>;
/** A plugin-defined failure code with the same fields as a built-in catalog entry. */
export interface PluginErrorDefinition { code: string; category: ErrorCategory; summary: string; hint: string; retryable?: boolean }
export interface CatalogedError { pluginId: string; code: string; exitCode: number; category: ErrorCategory; summary: string; hint: string; retryable: boolean }
type TextKind = 'commands' | 'actions' | 'generators' | 'events';
interface Owned { commands: readonly string[]; actions: readonly string[]; generators: readonly string[]; events: readonly string[] }

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const errorCode = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/** A user plugin's error code prefix: its id in UPPER_SNAKE_CASE and `_` (`quality-gate` → `QUALITY_GATE_`). */
export const errorPrefix = (pluginId: string) => `${pluginId.replaceAll('-', '_').toUpperCase()}_`;

/** The plugin-contributed localization and error catalog that the kernel catalogs fall back to. */
export class PluginCatalog {
  private readonly tables = new Map<string, PluginStrings>();
  private readonly codes = new Map<string, CatalogedError>();
  /** Error code prefixes of registered user plugins, by plugin id. */
  private readonly prefixes = new Map<string, string>();

  /** Validates one plugin's contributions; `prefix` restricts user plugin codes to `<ID>_…`. */
  static validate(pluginId: string, strings: unknown, errors: unknown, owned: Owned, prefix: string | null): void {
    ensure(errors === undefined || Array.isArray(errors), 'INVALID_PLUGIN', 'errors must be an array.');
    const codes = new Set<string>();
    for (const entry of (errors ?? []) as unknown[]) {
      ensure(isRecord(entry) && typeof entry.code === 'string' && errorCode.test(entry.code), 'INVALID_PLUGIN', 'Plugin error codes must be UPPER_SNAKE_CASE.');
      ensure(prefix === null || entry.code.startsWith(prefix), 'PLUGIN_NAMESPACE', `Error code ${entry.code} must start with ${prefix}.`);
      ensure(!errorDefinition(entry.code) && !codes.has(entry.code), 'DUPLICATE_OR_INVALID_ID', entry.code);
      ensure(Object.hasOwn(categoryExitCodes, String(entry.category)) && text(entry.summary) && text(entry.hint), 'INVALID_PLUGIN', `Error ${entry.code} requires a known category, a summary and a hint.`);
      ensure(entry.retryable === undefined || typeof entry.retryable === 'boolean', 'INVALID_PLUGIN', `Error ${entry.code} retryable must be a boolean.`);
      codes.add(entry.code);
    }
    ensure(strings === undefined || isRecord(strings), 'INVALID_PLUGIN', 'strings must map languages to string tables.');
    for (const [language, table] of Object.entries((strings ?? {}) as Record<string, unknown>)) {
      ensure((languages as readonly string[]).includes(language) && isRecord(table), 'INVALID_PLUGIN', `strings.${language} is not a supported language table (en, de).`);
      for (const [kind, entries] of Object.entries(table)) {
        ensure(['commands', 'actions', 'generators', 'events', 'errors', 'messages'].includes(kind) && isRecord(entries), 'INVALID_PLUGIN', `strings.${language}.${kind} is not a string table.`);
        for (const [id, entry] of Object.entries(entries)) {
          const known = kind === 'messages' || (kind === 'errors' ? codes.has(id) : owned[kind as TextKind].includes(id));
          ensure(known, 'PLUGIN_NAMESPACE', `strings.${language}.${kind}.${id} does not name a contribution of plugin ${pluginId}.`);
          ensure(kind === 'errors' ? isRecord(entry) && text(entry.summary) && text(entry.hint) : text(entry), 'INVALID_PLUGIN', `strings.${language}.${kind}.${id} must be ${kind === 'errors' ? 'a summary and hint' : 'nonempty text'}.`);
        }
      }
    }
  }

  /**
   * Checks, before anything registers, that one plugin's codes are new and that user plugin codes stay owned: a
   * code belongs to the registered user plugin with the longest matching prefix, so plugin `a` (`A_`) cannot
   * register `A_B_X` while plugin `a-b` (`A_B_`) is registered, and `a-b` cannot register after `a` registered
   * `A_B_X`. The later plugin fails with PLUGIN_NAMESPACE. `prefix` is null for core plugins.
   */
  ensureRegistrable(pluginId: string, errors: readonly PluginErrorDefinition[] | undefined, prefix: string | null): void {
    for (const entry of errors ?? []) ensure(!this.codes.has(entry.code), 'DUPLICATE_OR_INVALID_ID', entry.code);
    if (prefix === null) return;
    const prefixes = new Map([...this.prefixes, [pluginId, prefix]]);
    const owned = [
      ...[...this.codes.values()].filter(entry => this.prefixes.has(entry.pluginId)).map(entry => [entry.code, entry.pluginId] as const),
      ...(errors ?? []).map(entry => [entry.code, pluginId] as const),
    ];
    for (const [code, owner] of owned) {
      const [claimant, claimed] = [...prefixes].filter(([, candidate]) => code.startsWith(candidate)).sort((a, b) => b[1].length - a[1].length)[0]!;
      ensure(claimant === owner, 'PLUGIN_NAMESPACE', `Error code ${code} of plugin ${owner} falls in the namespace ${claimed} of plugin ${claimant}; plugin ${pluginId} cannot register.`);
    }
  }

  /** Registers a plugin that passed `ensureRegistrable` with the same `prefix`. */
  add(pluginId: string, strings: PluginStrings | undefined, errors: readonly PluginErrorDefinition[] | undefined, prefix: string | null = null): void {
    this.ensureRegistrable(pluginId, errors, prefix);
    if (prefix !== null) this.prefixes.set(pluginId, prefix);
    if (strings) this.tables.set(pluginId, strings);
    for (const entry of errors ?? []) {
      this.codes.set(entry.code, { pluginId, code: entry.code, exitCode: categoryExitCodes[entry.category], category: entry.category, summary: entry.summary, hint: entry.hint, retryable: entry.retryable ?? false });
    }
  }

  /** Contributed text for a command, generator or event id in `language`, if any. */
  text(language: Language, kind: TextKind, id: string): string | undefined {
    for (const table of this.tables.values()) {
      const entries = table[language]?.[kind];
      if (entries && Object.hasOwn(entries, id)) return entries[id];
    }
    return undefined;
  }

  /** A plugin message in `language`, falling back to English and then to the key itself. */
  message(pluginId: string, language: Language, key: string): string {
    const table = this.tables.get(pluginId);
    const pick = (tableLanguage: Language) => {
      const messages = table?.[tableLanguage]?.messages;
      return messages && Object.hasOwn(messages, key) ? messages[key] : undefined;
    };
    return pick(language) ?? pick('en') ?? key;
  }

  error(code: string): CatalogedError | undefined { return this.codes.get(code); }
  localizedError(code: string, language: Language): { summary: string; hint: string } | undefined {
    const entry = this.codes.get(code);
    const localized = entry ? this.tables.get(entry.pluginId)?.[language]?.errors?.[code] : undefined;
    return localized ?? (entry && language === 'en' ? { summary: entry.summary, hint: entry.hint } : undefined);
  }
  errors(): CatalogedError[] { return [...this.codes.values()]; }

  /**
   * Plugin code cannot construct host errors, so it throws an `Error` with a `code` (and optional `details`). This
   * turns a code that `pluginId` registered itself, or a built-in catalog code, into a coded failure with its
   * category's exit status. Another plugin's code stays an uncoded error: a plugin cannot borrow a code it does not
   * own. Anything else is unchanged.
   */
  normalize(error: unknown, pluginId: string): unknown {
    if (error instanceof AppError || !(error instanceof Error) || !('code' in error) || typeof error.code !== 'string') return error;
    const details = 'details' in error && isRecord(error.details) ? error.details : undefined;
    const builtIn = errorDefinition(error.code);
    if (builtIn) return codedError(error.code, error.message, builtIn.exitCode, details);
    const entry = this.codes.get(error.code);
    if (!entry || entry.pluginId !== pluginId) return error;
    return codedError(entry.code, error.message, entry.exitCode, details);
  }
}
