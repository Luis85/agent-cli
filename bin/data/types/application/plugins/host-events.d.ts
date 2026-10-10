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
    operation: 'read' | 'write' | 'edit' | 'remove' | 'move' | 'delete';
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
type Empty = Record<string, never>;
/** Obsidian's `CachedMetadata` shape as a JSON object; the kernel MetadataCache defines its fields. */
export type CachedMetadataRecord = Record<string, unknown>;
/** A committed vault change. Files carry their (prior, for deletion) revision and size; folders carry neither. */
export type VaultFileChange = FileChange & {
    kind: 'file';
};
export interface VaultFolderChange {
    path: string;
    kind: 'folder';
    operation: 'created' | 'deleted';
}
export type VaultChange = VaultFileChange | VaultFolderChange;
export type VaultRename = {
    path: string;
    oldPath: string;
} & ({
    kind: 'file';
    revision?: string;
} | {
    kind: 'folder';
});
export interface HostEventMap {
    'command.started': CommandOperation;
    'command.succeeded': CommandOperation;
    'command.failed': CommandOperation & {
        error: HostError;
    };
    'operation.started': WorkspaceOperation;
    'operation.succeeded': WorkspaceOperation & {
        changes?: FileChange[];
        bytes?: number;
        renames?: Array<{
            from: string;
            to: string;
            kind: 'file' | 'folder';
        }>;
    };
    'operation.failed': WorkspaceOperation & {
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
    'vault.create': VaultChange & {
        operation: 'created';
    };
    'vault.modify': VaultFileChange & {
        operation: 'updated';
    };
    'vault.delete': VaultChange & {
        operation: 'deleted';
    };
    'vault.rename': VaultRename;
    'metadataCache.changed': {
        path: string;
        cache: CachedMetadataRecord;
    };
    'metadataCache.deleted': {
        path: string;
        prevCache: CachedMetadataRecord | null;
    };
    'metadataCache.resolve': {
        path: string;
    };
    'metadataCache.resolved': Empty;
    'workspace.file-open': {
        path: string;
    };
    'workspace.quick-preview': {
        path: string;
        operation: FileChange['operation'];
        bytes: number;
    };
    'workspace.layout-ready': Empty;
    'workspace.quit': Empty;
    'workspace.project-change': {
        from: string | null;
        to: string | null;
    };
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
/** Namespaces owned by the host. Plugins cannot use them as ids and cannot emit their events. */
export declare const hostEventNamespaces: readonly ["command", "operation", "claude", "vault", "metadataCache", "workspace", "plugin"];
export declare function registerHostEvents(events: EventBus): void;
/** Host notifications never veto work. Small service fixtures may intentionally define only their observed events. */
export declare function publishHostEvent<Id extends HostEventId>(events: EventBus, id: Id, payload: HostEventMap[Id]): Promise<void>;
export {};
