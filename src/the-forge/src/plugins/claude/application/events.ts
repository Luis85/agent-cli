import { errorMessage, isRecord } from '../../../domain/shared/errors.ts';
import type { EventChannel, EventDefinition } from '../../../application/plugins/events.ts';

interface ClaudeOperation { operationId: number; executable: string; cwd: string; dryRun: boolean }
interface ClaudeError { code: string; exitCode: number }

/** The claude plugin's lifecycle records: one operation per Claude invocation, sharing the invocation's operation ids. */
export interface ClaudeEventMap {
  'claude.started': ClaudeOperation;
  'claude.succeeded': ClaudeOperation & { exitCode?: number };
  'claude.failed': ClaudeOperation & { error: ClaudeError; exitCode?: number };
  'claude.executed': { executable: string; cwd: string; exitCode: number };
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const status = (value: unknown): value is number => Number.isSafeInteger(value);
const operation = (value: Record<string, unknown>) => Number.isSafeInteger(value.operationId) && Number(value.operationId) > 0 && typeof value.dryRun === 'boolean'
  && text(value.executable) && text(value.cwd);
const error = (value: unknown) => isRecord(value) && text(value.code) && status(value.exitCode);
const optionalStatus = (value: Record<string, unknown>) => value.exitCode === undefined || status(value.exitCode);

function definition<Id extends keyof ClaudeEventMap>(id: Id, description: string, validate: (value: Record<string, unknown>) => boolean): EventDefinition<ClaudeEventMap[Id]> {
  return { id, description, validate: (value): value is ClaudeEventMap[Id] => isRecord(value) && validate(value) };
}

export const claudeEvents: readonly EventDefinition[] = [
  definition('claude.started', 'A Claude invocation began validation or preview.', operation),
  definition('claude.succeeded', 'A Claude invocation or validated preview completed.', value => operation(value) && optionalStatus(value)),
  definition('claude.failed', 'Claude validation, execution or output processing failed.', value => operation(value) && error(value.error) && optionalStatus(value)),
  definition('claude.executed', 'The Claude process returned an exit status, including nonzero status.', value => text(value.executable) && text(value.cwd) && status(value.exitCode)),
];

/** Lifecycle notifications never veto a Claude invocation: emission failures become warnings. */
export async function notifyClaude<Id extends keyof ClaudeEventMap>(events: EventChannel, id: Id, payload: ClaudeEventMap[Id]): Promise<void> {
  try {
    if (!events.ids().includes(id)) return;
    await events.emit(id, payload);
  } catch (failure) {
    try { events.warn(`Claude notification ${id}: ${errorMessage(failure)}`); }
    catch { /* A diagnostic sink cannot replace the Claude result. */ }
  }
}
