import { AppError, ensure, errorMessage, isRecord } from '../../domain/shared/errors.ts';
import { germanActions, germanCommands, germanEvents, germanGuidance } from './catalog.ts';
import { germanDescriptions } from './descriptions.ts';
import { germanKernelMessages } from './messages.ts';
import { renderWarning } from '../../domain/shared/kernel-messages.ts';
import type { CommandArgument, CommandOption } from '../../application/plugins/command-metadata.ts';
import { germanErrors } from './errors.ts';
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
  constructor(readonly language: Language = 'en', private readonly plugins?: PluginCatalog) {}

  private german(kind: 'commands' | 'generators' | 'events', id: string): string | undefined {
    // Every generator comes from a plugin, so only commands and events have kernel catalogs.
    const kernel = kind === 'commands' ? germanCommands : kind === 'events' ? germanEvents : undefined;
    return (kernel && translated(kernel, id)) ?? this.plugins?.text('de', kind, id);
  }

  /**
   * The command with German descriptions of itself and its actions where a catalog has them. Actions are keyed
   * `<command> <action>` in the kernel and plugin catalogs; `make` actions are generators.
   */
  command<T extends { id: string; description: string; options?: Options; args?: readonly CommandArgument[]; actions?: Readonly<Record<string, Described & { options?: Options }>> }>(command: T): T {
    if (this.language !== 'de') return command;
    const description = this.german('commands', command.id);
    const options = this.options(command.options), args = command.args && this.described(command.args);
    let translatedActions = false;
    const actions = command.actions && Object.fromEntries(Object.entries(command.actions).map(([id, action]) => {
      const key = `${command.id} ${id}`;
      const german = translated(germanActions, key) ?? this.plugins?.text('de', 'actions', key) ?? (command.id === 'make' ? this.german('generators', id) : undefined);
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
   * A host warning or plugin state reason in the response language. Plugin warnings keep their own text, and any
   * record that is not a message the host created reads as text, so it can neither pass for one nor break the response.
   */
  warning(warning: unknown): string {
    return renderWarning(warning, this.language === 'de' ? germanKernelMessages : undefined);
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

  private globalOptions(data: Record<string, unknown>): { globalOptions?: Options } {
    return isRecord(data.globalOptions) ? { globalOptions: this.options(data.globalOptions as Options) } : {};
  }

  private eventOutput(value: unknown): unknown {
    return isRecord(value) && typeof value.changes === 'string' ? { ...value, changes: germanGuidance.eventChanges } : value;
  }

  result(command: string, data: unknown): unknown {
    if (this.language === 'en' || !isRecord(data)) return data;
    if (command === 'schema' && Array.isArray(data.errors)) return { ...data, eventOutput: this.eventOutput(data.eventOutput), ...this.globalOptions(data), generators: this.catalogued('generators', data.generators), errors: this.errors(data.errors) };
    if (['help', 'schema', 'make'].includes(command) && Array.isArray(data.generators)) return { ...data, ...(data.eventOutput === undefined ? {} : { eventOutput: this.eventOutput(data.eventOutput) }), ...this.globalOptions(data), generators: this.catalogued('generators', data.generators) };
    if (command === 'help' && isRecord(data.globalOptions)) return { ...data, ...this.globalOptions(data) };
    if (command === 'config' && Array.isArray(data.sections)) return { ...data, sections: data.sections.map((section: unknown) => isRecord(section) ? { ...section, schema: this.schema(section.schema) } : section) };
    if (command === 'formats') return { ...data, textFiles: germanGuidance.textFiles, attachments: germanGuidance.attachments, otherFiles: germanGuidance.otherFiles };
    if (command === 'events') return { ...data, contracts: this.catalogued('events', data.contracts), delivery: germanGuidance.delivery };
    if (command === 'setup' && Array.isArray(data.nextSteps)) return {
      ...data, nextSteps: data.nextSteps.map((step: unknown) => {
        if (!isRecord(step) || typeof step.command !== 'string') return step;
        const purpose = translated(germanGuidance.setup, step.command);
        return purpose ? { ...step, purpose } : step;
      }),
    };
    return data;
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
    if (!german) return { code, message: diagnostic, hint: definition.hint, retryable, ...(details ? { details } : {}) };
    // A namespaced diagnostic preserves plugin/application details, including their own diagnostic key.
    return { code, message: german.summary, hint: german.hint, retryable, details: { ...details, localization: { originalMessage: diagnostic, ...(details?.localization !== undefined ? { originalDetails: details.localization } : {}) } } };
  }
}
