import { AppError, ensure, errorMessage, isRecord } from '../../domain/shared/errors.ts';
import { germanActions, germanCommands, germanEvents, germanGuidance } from './catalog.ts';
import { germanDescriptions } from './descriptions.ts';
import { germanKernelMessages } from './messages.ts';
import { responseWarning, type Warning } from '../../domain/shared/warnings.ts';
import type { CommandArgument, CommandMetadata, CommandOption, OutputLocalization } from '../../application/plugins/command-metadata.ts';
import { germanErrors, germanHintVariant } from './errors.ts';
import { germanErrorMessage, locatedGermanSummary } from './error-messages.ts';
import { guidedHint } from './hints.ts';
import { errorDefinition, type ErrorCode } from '../../domain/shared/error-catalog.ts';
import type { Language, PluginCatalog } from '../../application/plugins/plugin-catalog.ts';

export interface LocalizedError { code: string; message: string; hint?: string; retryable?: boolean; details?: Record<string, unknown> }
export function language(value: string): Language {
  ensure(value === 'en' || value === 'de', 'INVALID_LANGUAGE', 'Unsupported language. Use --lang en or --lang de.');
  return value;
}
function translated(catalog: Record<string, string>, id: string): string | undefined {
  return Object.hasOwn(catalog, id) ? catalog[id] : undefined;
}
type Described = { description: string };
type Options = Readonly<Record<string, CommandOption>>;

/**
 * Localize declared presentation metadata only; never traverse user documents or plugin results. Kernel
 * catalogs come first; strings and error entries contributed by plugins fill in their own ids and codes.
 */
export class Localizer {
  /** `invoked` is the invoked command id, which hints name in place of their `help <command>` placeholder. */
  constructor(readonly language: Language = 'en', private readonly plugins?: PluginCatalog, private readonly invoked?: string) {}

  private german(kind: 'commands' | 'generators' | 'events', id: string): string | undefined {
    // Every generator comes from a plugin, so only commands and events have kernel catalogs.
    const kernel = kind === 'commands' ? germanCommands : kind === 'events' ? germanEvents : undefined;
    return (kernel && translated(kernel, id)) ?? this.plugins?.text('de', kind, id);
  }

  /**
   * The command with German descriptions of itself and its actions where a catalog has them. Actions are keyed
   * `<command> <action>` in the kernel and plugin catalogs; the actions of a command with `generatorActions` are
   * generators, described by generator id.
   */
  command<T extends { id: string; description: string; options?: Options; args?: readonly CommandArgument[]; actions?: Readonly<Record<string, Described & { options?: Options }>>; generatorActions?: boolean }>(command: T): T {
    if (this.language !== 'de') return command;
    const description = this.german('commands', command.id);
    const options = this.options(command.options), args = command.args && this.described(command.args);
    let translatedActions = false;
    const actions = command.actions && Object.fromEntries(Object.entries(command.actions).map(([id, action]) => {
      const key = `${command.id} ${id}`;
      const german = translated(germanActions, key) ?? this.plugins?.text('de', 'actions', key) ?? (command.generatorActions ? this.german('generators', id) : undefined);
      const actionOptions = this.options(action.options);
      if (german || actionOptions !== action.options) translatedActions = true;
      return [id, { ...action, ...(german ? { description: german } : {}), ...(actionOptions ? { options: actionOptions } : {}) }];
    }));
    if (!description && !translatedActions && options === command.options && args === command.args) return command;
    return { ...command, ...(description ? { description } : {}), ...(options ? { options } : {}), ...(args ? { args } : {}), ...(translatedActions ? { actions } : {}) };
  }

  /** An option, argument or settings description in the response language, by its English text. */
  description(english: string): string {
    if (this.language !== 'de') return english;
    return translated(germanDescriptions, english) ?? this.plugins?.description('de', english) ?? english;
  }

  /** Option and argument descriptions, including the descriptions inside the JSON document schema one declares. */
  private described<T extends Described & { schema?: unknown }>(items: readonly T[]): readonly T[] {
    if (this.language !== 'de') return items;
    return items.map(item => ({ ...item, description: this.description(item.description), ...(item.schema === undefined ? {} : { schema: this.schema(item.schema) }) }));
  }

  private options<T extends Options | undefined>(options: T): T {
    if (!options) return options;
    const entries = Object.entries(options), values = entries.map(([, option]) => option), localized = this.described(values);
    return (localized === values ? options : Object.fromEntries(entries.map(([name], index) => [name, localized[index]]))) as T;
  }

  /** `description` texts inside a JSON Schema: a plugin settings schema, as `config` reports it, or an option's document. */
  private schema(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(item => this.schema(item));
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'description' && typeof item === 'string' ? this.description(item) : this.schema(item)]));
  }

  /**
   * A host warning or plugin state reason as the response's `{code, message, details?}`: host messages in the
   * response language, plugin warnings as raised. Any record that is not a message the host created reads as
   * PLUGIN_WARNING text, so it can neither pass for one nor break the response.
   */
  warning(warning: unknown): Warning {
    return responseWarning(warning, this.language === 'de' ? germanKernelMessages : undefined);
  }

  /** A plugin's manifest `name` and `description` in the response language. */
  manifest<T extends { id: string; name: string; description: string }>(manifest: T): T {
    const localized = this.language === 'de' ? this.plugins?.manifest(manifest.id, 'de') : undefined;
    return localized ? { ...manifest, ...localized } : manifest;
  }

  private catalogued(kind: 'generators' | 'events', items: unknown): unknown {
    if (!Array.isArray(items)) return items;
    return items.map((item: unknown) => {
      if (!isRecord(item) || typeof item.id !== 'string') return item;
      const description = this.german(kind, item.id);
      return description ? { ...item, description } : item;
    });
  }

  private errors(items: unknown[]): unknown[] {
    return items.map((item: unknown) => {
      if (!isRecord(item) || typeof item.code !== 'string') return item;
      const summary = errorDefinition(item.code) ? germanErrors[item.code as ErrorCode].summary : this.plugins?.localizedError(item.code, 'de')?.summary;
      return summary ? { ...item, summary } : item;
    });
  }

  /** English guidance text in the response language, by its text, wherever `value` holds it. */
  private text(value: unknown): unknown {
    if (typeof value === 'string') return translated(germanGuidance, value) ?? this.plugins?.description('de', value) ?? value;
    if (Array.isArray(value)) return value.map(item => this.text(item));
    return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.text(item)])) : value;
  }

  private output(kind: OutputLocalization, value: unknown): unknown {
    switch (kind) {
      case 'text': return this.text(value);
      case 'generators': case 'events': return this.catalogued(kind, value);
      case 'errors': return Array.isArray(value) ? this.errors(value) : value;
      case 'options': return isRecord(value) ? this.options(value as Options) : value;
      case 'settings': return Array.isArray(value) ? value.map((section: unknown) => isRecord(section) ? { ...section, schema: this.schema(section.schema) } : section) : value;
    }
  }

  /** A successful result in the response language: only the fields the command's `localizedOutput` names change. */
  result(command: Pick<CommandMetadata, 'localizedOutput'> | undefined, data: unknown): unknown {
    const fields = command?.localizedOutput;
    if (this.language === 'en' || fields === undefined || !isRecord(data)) return data;
    const localized = Object.entries(fields).filter(([field]) => Object.hasOwn(data, field));
    return localized.length === 0 ? data : { ...data, ...Object.fromEntries(localized.map(([field, kind]) => [field, this.output(kind, data[field])])) };
  }

  /** Built-in and plugin-registered codes add a catalog hint and retryability; other plugin codes keep their own shape. */
  error(error: unknown): LocalizedError {
    const code = error instanceof AppError ? error.code : 'OPERATION_FAILED';
    const diagnostic = errorMessage(error);
    let details = error instanceof AppError ? error.details : undefined;
    // Plugin diagnostics must not replace the original error when encoding the envelope.
    if (details) {
      try { details = JSON.parse(JSON.stringify(details)) as Record<string, unknown>; }
      catch { details = { diagnostic: 'Error details were not JSON-serializable.' }; }
    }
    const builtIn = errorDefinition(code), contributed = builtIn ? undefined : this.plugins?.error(code);
    const definition = builtIn ?? contributed;
    if (!definition) return { code, message: diagnostic, ...(details ? { details } : {}) };
    const retryable = error instanceof AppError && error.retryable !== undefined ? error.retryable : definition.retryable;
    const german = this.language !== 'de' ? undefined : builtIn ? germanErrors[code as ErrorCode] : this.plugins?.localizedError(code, 'de');
    // A built-in code may refine its hint by details of the occurrence, such as the lock state of WORKSPACE_BUSY.
    const hints = builtIn?.variants?.hints ?? {};
    const refined = builtIn?.variants?.details.map(key => details?.[key]).find((value): value is string => typeof value === 'string' && Object.hasOwn(hints, value));
    if (!german) return { code, message: diagnostic, hint: guidedHint(refined ? builtIn!.variants!.hints[refined]! : definition.hint, code, details, 'en', this.invoked), retryable, ...(details ? { details } : {}) };
    const germanHint = refined === undefined ? undefined : germanHintVariant(code as ErrorCode, refined);
    // Built-in codes keep the concrete values of the occurrence where a German template covers its details.
    const message = builtIn ? germanErrorMessage(code as ErrorCode, details) ?? locatedGermanSummary(details, german.summary) : german.summary;
    // A namespaced diagnostic preserves plugin/application details, including their own diagnostic key.
    return { code, message, hint: guidedHint(germanHint ?? german.hint, code, details, 'de', this.invoked), retryable, details: { ...details, localization: { originalMessage: diagnostic, ...(details?.localization !== undefined ? { originalDetails: details.localization } : {}) } } };
  }
}
