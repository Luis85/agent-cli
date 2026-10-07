import { isRecord, errorMessage } from '../../domain/shared/errors.ts';
import type { FileChange } from '../../domain/documents/file.ts';
import type { EventBus, EventDefinition } from './events.ts';

interface HostError { code: string; exitCode: number }
interface CommandOperation { operationId: number; command: string; root: string; workspaceRoot: string; dryRun: boolean }
interface WorkspaceOperation { operationId: number; operation: 'read' | 'write' | 'edit' | 'remove'; root: string | null; paths: string[]; dryRun: boolean }
interface ClaudeOperation { operationId: number; executable: string; cwd: string; dryRun: boolean }
interface PluginOperation { pluginId: string }

export interface HostEventMap {
  'command.started': CommandOperation;
  'command.succeeded': CommandOperation;
  'command.failed': CommandOperation & { error: HostError };
  'workspace.started': WorkspaceOperation;
  'workspace.succeeded': WorkspaceOperation & { changes?: FileChange[]; bytes?: number };
  'workspace.failed': WorkspaceOperation & { error: HostError };
  'claude.started': ClaudeOperation;
  'claude.succeeded': ClaudeOperation & { exitCode?: number };
  'claude.failed': ClaudeOperation & { error: HostError; exitCode?: number };
  'claude.executed': { executable: string; cwd: string; exitCode: number };
  'file.created': FileChange;
  'file.updated': FileChange;
  'file.deleted': FileChange;
  'plugin.registered': PluginOperation;
  'plugin.activating': PluginOperation;
  'plugin.activated': PluginOperation;
  'plugin.activation-failed': PluginOperation & { error: HostError };
  'plugin.unloading': PluginOperation;
  'plugin.unloaded': PluginOperation;
  'plugin.unload-failed': PluginOperation & { error: HostError };
}
export type HostEventId = keyof HostEventMap;
export type HostEventRecord = { [Id in HostEventId]: { id: Id; payload: HostEventMap[Id] } }[HostEventId];

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const status = (value: unknown): value is number => Number.isSafeInteger(value);
const operation = (value: Record<string, unknown>) => count(value.operationId) && Number(value.operationId) > 0 && typeof value.dryRun === 'boolean';
const error = (value: unknown) => isRecord(value) && text(value.code) && status(value.exitCode);
const command = (value: Record<string, unknown>) => operation(value) && text(value.command) && text(value.root) && text(value.workspaceRoot);
const workspace = (value: Record<string, unknown>) => operation(value) && ['read', 'write', 'edit', 'remove'].includes(String(value.operation)) && (value.root === null || text(value.root)) && Array.isArray(value.paths) && value.paths.every(text);
const claude = (value: Record<string, unknown>) => operation(value) && text(value.executable) && text(value.cwd);
const plugin = (value: Record<string, unknown>) => text(value.pluginId);
const change = (value: unknown): value is FileChange => isRecord(value) && text(value.path) && text(value.revision) && count(value.bytes) && ['created', 'updated', 'deleted'].includes(String(value.operation));
const optionalStatus = (value: Record<string, unknown>) => value.exitCode === undefined || status(value.exitCode);

function definition<Id extends HostEventId>(id: Id, description: string, validate: (value: Record<string, unknown>) => boolean): EventDefinition<HostEventMap[Id]> {
  return { id, description, validate: (value): value is HostEventMap[Id] => isRecord(value) && validate(value) };
}

const hostEventDefinitions: readonly EventDefinition[] = [
  definition('command.started', 'A routed command is about to activate plugins and run.', command),
  definition('command.succeeded', 'A routed command returned successfully.', command),
  definition('command.failed', 'A routed command failed; error codes contain no command input.', value => command(value) && error(value.error)),
  definition('workspace.started', 'A guarded workspace operation started, including previews.', workspace),
  definition('workspace.succeeded', 'A guarded workspace operation completed, including previews.', value => workspace(value) && (value.bytes === undefined || count(value.bytes)) && (value.changes === undefined || (Array.isArray(value.changes) && value.changes.every(change)))),
  definition('workspace.failed', 'A guarded workspace operation failed.', value => workspace(value) && error(value.error)),
  definition('claude.started', 'A Claude invocation began validation or preview.', claude),
  definition('claude.succeeded', 'A Claude invocation or validated preview completed.', value => claude(value) && optionalStatus(value)),
  definition('claude.failed', 'Claude validation, execution or output processing failed.', value => claude(value) && error(value.error) && optionalStatus(value)),
  definition('claude.executed', 'The Claude process returned an exit status, including nonzero status.', value => text(value.executable) && text(value.cwd) && status(value.exitCode)),
  definition('file.created', 'A file was committed after successful persistence.', value => change(value) && value.operation === 'created'),
  definition('file.updated', 'An existing file was committed after successful persistence.', value => change(value) && value.operation === 'updated'),
  definition('file.deleted', 'A file was removed; revision and bytes describe its prior content.', value => change(value) && value.operation === 'deleted'),
  definition('plugin.registered', 'A plugin passed atomic contribution registration.', plugin),
  definition('plugin.activating', 'A registered plugin is about to run its activation hook.', plugin),
  definition('plugin.activated', 'A plugin activation hook completed successfully.', plugin),
  definition('plugin.activation-failed', 'A plugin activation failed; captured cleanup remains scheduled.', value => plugin(value) && error(value.error)),
  definition('plugin.unloading', 'A started plugin is about to release its invocation resources.', plugin),
  definition('plugin.unloaded', 'A plugin cleanup completed successfully.', plugin),
  definition('plugin.unload-failed', 'A plugin cleanup failed; remaining cleanup still proceeds.', value => plugin(value) && error(value.error)),
];

export function registerHostEvents(events: EventBus): void { events.defineAll(hostEventDefinitions); }

/** Host notifications never veto work. Small service fixtures may intentionally define only their observed events. */
export async function publishHostEvent<Id extends HostEventId>(events: EventBus, id: Id, payload: HostEventMap[Id]): Promise<void> {
  try {
    if (!events.ids().includes(id)) return;
    await events.emit(id, payload);
  } catch (error) {
    try { events.warn(`Host notification ${id}: ${errorMessage(error)}`); }
    catch { /* A diagnostic sink cannot replace the host operation's result. */ }
  }
}
