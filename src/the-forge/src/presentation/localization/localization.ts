import { AppError, ensure, errorMessage, isRecord } from '../../domain/shared/errors.ts';
import { germanCommands, germanEvents, germanGenerators, germanGuidance } from './catalog.ts';
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

/**
 * Localize declared presentation metadata only; never traverse user documents or plugin results. Kernel
 * catalogs come first; strings and error entries contributed by plugins fill in their own ids and codes.
 */
export class Localizer {
  constructor(readonly language: Language = 'en', private readonly plugins?: PluginCatalog) {}

  private german(kind: 'commands' | 'generators' | 'events', id: string): string | undefined {
    const kernel = kind === 'commands' ? germanCommands : kind === 'generators' ? germanGenerators : germanEvents;
    return translated(kernel, id) ?? this.plugins?.text('de', kind, id);
  }

  command<T extends { id: string; description: string }>(command: T): T {
    const description = this.language === 'de' ? this.german('commands', command.id) : undefined;
    return description ? { ...command, description } : command;
  }

  private described(kind: 'generators' | 'events', items: unknown): unknown {
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

  private eventOutput(value: unknown): unknown {
    return isRecord(value) && typeof value.changes === 'string' ? { ...value, changes: germanGuidance.eventChanges } : value;
  }

  result(command: string, data: unknown): unknown {
    if (this.language === 'en' || !isRecord(data)) return data;
    if (command === 'schema' && Array.isArray(data.errors)) return { ...data, eventOutput: this.eventOutput(data.eventOutput), generators: this.described('generators', data.generators), errors: this.errors(data.errors) };
    if (['help', 'schema', 'make'].includes(command) && Array.isArray(data.generators)) return { ...data, ...(data.eventOutput === undefined ? {} : { eventOutput: this.eventOutput(data.eventOutput) }), generators: this.described('generators', data.generators) };
    if (['components', 'data-sources', 'interactions'].includes(command) && data.status === 'empty' && typeof data.directory === 'string' && typeof data.nextStep === 'string') {
      return { ...data, nextStep: `Führen Sie ${command} init --library ${data.directory} aus oder fügen Sie eine Markdown-Definition hinzu.` };
    }
    if (command === 'formats') return { ...data, textFiles: germanGuidance.textFiles, attachments: germanGuidance.attachments, otherFiles: germanGuidance.otherFiles };
    if (command === 'events') return { ...data, contracts: this.described('events', data.contracts), delivery: germanGuidance.delivery };
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
    const german = this.language !== 'de' ? undefined : builtIn ? germanErrors[code as ErrorCode] : this.plugins?.localizedError(code, 'de');
    if (!german) return { code, message: diagnostic, hint: definition.hint, retryable: definition.retryable, ...(details ? { details } : {}) };
    // A namespaced diagnostic preserves plugin/application details, including their own diagnostic key.
    return { code, message: german.summary, hint: german.hint, retryable: definition.retryable, details: { ...details, localization: { originalMessage: diagnostic, ...(details?.localization !== undefined ? { originalDetails: details.localization } : {}) } } };
  }
}
