import { AppError, ensure, isRecord } from '../domain/errors.ts';
import { germanCommands, germanGenerators, germanGuidance } from './localization-catalog.ts';
import { germanErrors } from './localization-errors.ts';

export type Language = 'en' | 'de';
export function language(value: string): Language {
  ensure(value === 'en' || value === 'de', 'INVALID_LANGUAGE', 'Unsupported language. Use --lang en or --lang de.');
  return value;
}
function translated(catalog: Record<string, string>, id: string): string | undefined {
  return Object.hasOwn(catalog, id) ? catalog[id] : undefined;
}

/** Localize declared presentation metadata only; never traverse user documents or plugin results. */
export class Localizer {
  constructor(readonly language: Language = 'en') {}

  command<T extends { id: string; description: string }>(command: T): T {
    const description = this.language === 'de' ? translated(germanCommands, command.id) : undefined;
    return description ? { ...command, description } : command;
  }

  private generators(items: unknown): unknown {
    if (!Array.isArray(items)) return items;
    return items.map((item: unknown) => {
      if (!isRecord(item) || typeof item.id !== 'string') return item;
      const description = translated(germanGenerators, item.id);
      return description ? { ...item, description } : item;
    });
  }

  result(command: string, data: unknown): unknown {
    if (this.language === 'en' || !isRecord(data)) return data;
    if (['help', 'schema', 'make'].includes(command) && Array.isArray(data.generators)) return { ...data, generators: this.generators(data.generators) };
    if (['components', 'data-sources', 'interactions'].includes(command) && data.status === 'empty' && typeof data.directory === 'string' && typeof data.nextStep === 'string') {
      return { ...data, nextStep: `Führen Sie ${command} init --library ${data.directory} aus oder fügen Sie eine Markdown-Definition hinzu.` };
    }
    if (command === 'formats') return { ...data, attachments: germanGuidance.attachments, otherFiles: germanGuidance.otherFiles };
    if (command === 'events') return { ...data, delivery: germanGuidance.delivery };
    if (command === 'setup' && Array.isArray(data.nextSteps)) return {
      ...data, nextSteps: data.nextSteps.map((step: unknown) => {
        if (!isRecord(step) || typeof step.command !== 'string') return step;
        const purpose = translated(germanGuidance.setup, step.command);
        return purpose ? { ...step, purpose } : step;
      }),
    };
    return data;
  }

  error(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
    const code = error instanceof AppError ? error.code : 'OPERATION_FAILED';
    const diagnostic = error instanceof Error ? error.message : String(error);
    const details = error instanceof AppError ? error.details : undefined;
    const message = this.language === 'de' ? translated(germanErrors, code) : undefined;
    if (!message) return { code, message: diagnostic, ...(details ? { details } : {}) };
    // A namespaced diagnostic preserves plugin/application details, including their own diagnostic key.
    return { code, message, details: { ...details, localization: { originalMessage: diagnostic, ...(details?.localization !== undefined ? { originalDetails: details.localization } : {}) } } };
  }
}
