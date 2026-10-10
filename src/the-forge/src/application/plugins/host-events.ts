import { isRecord, errorMessage } from '../../domain/shared/errors.ts';
import type { FileChange } from '../../domain/documents/file.ts';
import type { EventBus, EventDefinition } from './events.ts';

interface HostError { code: string; exitCode: number }
interface CommandOperation { operationId: number; command: string; root: string; workspaceRoot: string; dryRun: boolean }
interface WorkspaceOperation { operationId: number; operation: 'read' | 'write' | 'edit' | 'remove'; root: string | null; paths: string[]; dryRun: boolean }
interface ClaudeOperation { operationId: number; executable: string; cwd: string; dryRun: boolean }
interface PluginOperation { pluginId: string }
type Empty = Record<string, never>;
/** Obsidian's `CachedMetadata` shape as a JSON object; the kernel MetadataCache defines its fields. */
export type CachedMetadataRecord = Record<string, unknown>;

/** A committed vault change. Files carry their (prior, for deletion) revision and size; folders carry neither. */
export type VaultFileChange = FileChange & { kind: 'file' };
export interface VaultFolderChange { path: string; kind: 'folder'; operation: 'created' | 'deleted' }
export type VaultChange = VaultFileChange | VaultFolderChange;
export type VaultRename = { path: string; oldPath: string } & ({ kind: 'file'; revision?: string } | { kind: 'folder' });

export interface HostEventMap {
  'command.started': CommandOperation;
  'command.succeeded': CommandOperation;
  'command.failed': CommandOperation & { error: HostError };
  'operation.started': WorkspaceOperation;
  'operation.succeeded': WorkspaceOperation & { changes?: FileChange[]; bytes?: number };
  'operation.failed': WorkspaceOperation & { error: HostError };
  'claude.started': ClaudeOperation;
  'claude.succeeded': ClaudeOperation & { exitCode?: number };
  'claude.failed': ClaudeOperation & { error: HostError; exitCode?: number };
  'claude.executed': { executable: string; cwd: string; exitCode: number };
  'vault.create': VaultChange & { operation: 'created' };
  'vault.modify': VaultFileChange & { operation: 'updated' };
  'vault.delete': VaultChange & { operation: 'deleted' };
  'vault.rename': VaultRename;
  'metadataCache.changed': { path: string; cache: CachedMetadataRecord };
  'metadataCache.deleted': { path: string; prevCache: CachedMetadataRecord | null };
  'metadataCache.resolve': { path: string };
  'metadataCache.resolved': Empty;
  'workspace.file-open': { path: string };
  'workspace.quick-preview': { path: string; operation: FileChange['operation']; bytes: number };
  'workspace.layout-ready': Empty;
  'workspace.quit': Empty;
  'workspace.project-change': { from: string | null; to: string | null };
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

/** Namespaces owned by the host. Plugins cannot use them as ids and cannot emit their events. */
export const hostEventNamespaces = ['command', 'operation', 'claude', 'vault', 'metadataCache', 'workspace', 'plugin'] as const;

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const status = (value: unknown): value is number => Number.isSafeInteger(value);
const empty = (value: Record<string, unknown>) => Object.keys(value).length === 0;
const operation = (value: Record<string, unknown>) => count(value.operationId) && Number(value.operationId) > 0 && typeof value.dryRun === 'boolean';
const error = (value: unknown) => isRecord(value) && text(value.code) && status(value.exitCode);
const command = (value: Record<string, unknown>) => operation(value) && text(value.command) && text(value.root) && text(value.workspaceRoot);
const workspace = (value: Record<string, unknown>) => operation(value) && ['read', 'write', 'edit', 'remove'].includes(String(value.operation)) && (value.root === null || text(value.root)) && Array.isArray(value.paths) && value.paths.every(text);
const claude = (value: Record<string, unknown>) => operation(value) && text(value.executable) && text(value.cwd);
const plugin = (value: Record<string, unknown>) => text(value.pluginId);
const changeOperations = ['created', 'updated', 'deleted'];
const change = (value: unknown): value is FileChange => isRecord(value) && text(value.path) && text(value.revision) && count(value.bytes) && changeOperations.includes(String(value.operation));
const optionalStatus = (value: Record<string, unknown>) => value.exitCode === undefined || status(value.exitCode);
const project = (value: unknown) => value === null || text(value);
/** Files carry revision and bytes; folders carry neither. */
const vault = (expected: string, kinds: readonly string[]) => (value: Record<string, unknown>) => value.operation === expected && kinds.includes(String(value.kind))
  && (value.kind === 'file' ? change(value) && Object.keys(value).length === 5 : text(value.path) && Object.keys(value).length === 3);
const rename = (value: Record<string, unknown>) => text(value.path) && text(value.oldPath) && value.path !== value.oldPath
  && (value.kind === 'file' ? value.revision === undefined || text(value.revision) : value.kind === 'folder' && value.revision === undefined);

function definition<Id extends HostEventId>(id: Id, description: string, validate: (value: Record<string, unknown>) => boolean): EventDefinition<HostEventMap[Id]> {
  return { id, description, validate: (value): value is HostEventMap[Id] => isRecord(value) && validate(value) };
}

const hostEventDefinitions: readonly EventDefinition[] = [
  definition('command.started', 'A routed command is about to activate plugins and run.', command),
  definition('command.succeeded', 'A routed command returned successfully.', command),
  definition('command.failed', 'A routed command failed; error codes contain no command input.', value => command(value) && error(value.error)),
  definition('operation.started', 'A guarded workspace operation started, including previews.', workspace),
  definition('operation.succeeded', 'A guarded workspace operation completed, including previews.', value => workspace(value) && (value.bytes === undefined || count(value.bytes)) && (value.changes === undefined || (Array.isArray(value.changes) && value.changes.every(change)))),
  definition('operation.failed', 'A guarded workspace operation failed.', value => workspace(value) && error(value.error)),
  definition('claude.started', 'A Claude invocation began validation or preview.', claude),
  definition('claude.succeeded', 'A Claude invocation or validated preview completed.', value => claude(value) && optionalStatus(value)),
  definition('claude.failed', 'Claude validation, execution or output processing failed.', value => claude(value) && error(value.error) && optionalStatus(value)),
  definition('claude.executed', 'The Claude process returned an exit status, including nonzero status.', value => text(value.executable) && text(value.cwd) && status(value.exitCode)),
  definition('vault.create', 'A file or folder was created by a committed write.', vault('created', ['file', 'folder'])),
  definition('vault.modify', 'An existing file was replaced by a committed write.', vault('updated', ['file'])),
  definition('vault.delete', 'A file or folder was removed; a file\'s revision and bytes describe its prior content.', vault('deleted', ['file', 'folder'])),
  definition('vault.rename', 'A file or folder moved from oldPath to path in a committed batch.', rename),
  definition('metadataCache.changed', 'A committed Markdown file was indexed; cache is its JSON metadata.', value => text(value.path) && isRecord(value.cache)),
  definition('metadataCache.deleted', 'A deleted file left the index; prevCache is its best-effort previous metadata or null.', value => text(value.path) && (value.prevCache === null || isRecord(value.prevCache))),
  definition('metadataCache.resolve', 'A file\'s resolved and unresolved links were updated.', value => text(value.path) && Object.keys(value).length === 1),
  definition('metadataCache.resolved', 'Link resolution finished for a committed batch.', empty),
  definition('workspace.file-open', 'A command read a file through the workspace read path.', value => text(value.path) && Object.keys(value).length === 1),
  definition('workspace.quick-preview', 'A dry run previewed a planned file change without writing it.', value => text(value.path) && changeOperations.includes(String(value.operation)) && count(value.bytes) && Object.keys(value).length === 3),
  definition('workspace.layout-ready', 'Plugins are active and the command is about to run.', empty),
  definition('workspace.quit', 'The invocation is ending; best-effort quit tasks follow before plugins unload.', empty),
  definition('workspace.project-change', 'project open or project close committed a different project selection.', value => project(value.from) && project(value.to) && value.from !== value.to && Object.keys(value).length === 2),
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
