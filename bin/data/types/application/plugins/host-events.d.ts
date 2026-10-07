import type { FileChange } from '../../domain/documents/file.ts';
import type { EventBus } from './events.ts';
interface HostError {
    code: string;
    exitCode: number;
}
interface CommandOperation {
    operationId: number;
    command: string;
    root: string;
    workspaceRoot: string;
    dryRun: boolean;
}
interface WorkspaceOperation {
    operationId: number;
    operation: 'read' | 'write' | 'edit' | 'remove';
    root: string | null;
    paths: string[];
    dryRun: boolean;
}
interface ClaudeOperation {
    operationId: number;
    executable: string;
    cwd: string;
    dryRun: boolean;
}
interface PluginOperation {
    pluginId: string;
}
export interface HostEventMap {
    'command.started': CommandOperation;
    'command.succeeded': CommandOperation;
    'command.failed': CommandOperation & {
        error: HostError;
    };
    'workspace.started': WorkspaceOperation;
    'workspace.succeeded': WorkspaceOperation & {
        changes?: FileChange[];
        bytes?: number;
    };
    'workspace.failed': WorkspaceOperation & {
        error: HostError;
    };
    'claude.started': ClaudeOperation;
    'claude.succeeded': ClaudeOperation & {
        exitCode?: number;
    };
    'claude.failed': ClaudeOperation & {
        error: HostError;
        exitCode?: number;
    };
    'claude.executed': {
        executable: string;
        cwd: string;
        exitCode: number;
    };
    'file.created': FileChange;
    'file.updated': FileChange;
    'file.deleted': FileChange;
    'plugin.registered': PluginOperation;
    'plugin.activating': PluginOperation;
    'plugin.activated': PluginOperation;
    'plugin.activation-failed': PluginOperation & {
        error: HostError;
    };
    'plugin.unloading': PluginOperation;
    'plugin.unloaded': PluginOperation;
    'plugin.unload-failed': PluginOperation & {
        error: HostError;
    };
}
export type HostEventId = keyof HostEventMap;
export type HostEventRecord = {
    [Id in HostEventId]: {
        id: Id;
        payload: HostEventMap[Id];
    };
}[HostEventId];
export declare function registerHostEvents(events: EventBus): void;
/** Host notifications never veto work. Small service fixtures may intentionally define only their observed events. */
export declare function publishHostEvent<Id extends HostEventId>(events: EventBus, id: Id, payload: HostEventMap[Id]): Promise<void>;
export {};
