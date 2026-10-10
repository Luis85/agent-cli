import type { Workspace } from '../workspace/workspace.ts';
/** What the host remembers about an enabled plugin between invocations. */
export interface PluginStateEntry {
    settings: string | null;
}
export type PluginStates = Record<string, PluginStateEntry>;
/**
 * Persists first-activation and settings state. `settingsRevision` identifies the plugin's current
 * settings; `null` means it has no settings source, which is the case until plugin config sections exist.
 */
export interface PluginStateStore {
    load(): Promise<PluginStates>;
    save(states: PluginStates): Promise<void>;
    settingsRevision(pluginId: string): Promise<string | null>;
}
/** The activation hooks the tracker calls; `C` is the plugin-scoped command context. */
interface TrackedPlugin<C> {
    manifest: {
        id: string;
    };
    onUserEnable?(context: C): void | Promise<void>;
    onExternalSettingsChange?(context: C): void | Promise<void>;
}
export declare const pluginStatePath = "bin/data/plugins-state.json";
/** Workspace data in `bin/data/plugins-state.json`, written with a revision guard; dry runs never persist. */
export declare class WorkspacePluginState implements PluginStateStore {
    private readonly workspace;
    private readonly warn;
    private readonly settings;
    private revision;
    private stored;
    constructor(workspace: Workspace, warn: (message: string) => void, settings?: (pluginId: string) => Promise<string | null>);
    settingsRevision(pluginId: string): Promise<string | null>;
    load(): Promise<PluginStates>;
    save(states: PluginStates): Promise<void>;
}
/**
 * Calls `onUserEnable` on the first activation after a plugin is enabled, and `onExternalSettingsChange`
 * when its settings revision changed since its last activation. Only plugins implementing a hook are tracked.
 */
export declare class ActivationTracker {
    private readonly store;
    private readonly previous;
    private readonly next;
    private constructor();
    static load(store: PluginStateStore): Promise<ActivationTracker>;
    activated<C>(plugin: TrackedPlugin<C>, context: C): Promise<void>;
    /** Keeps unreached enabled plugins' entries and forgets disabled plugins; a failed save is a warning. */
    save(plugins: ReadonlyArray<TrackedPlugin<unknown>>, warn: (message: string) => void): Promise<void>;
}
export {};
