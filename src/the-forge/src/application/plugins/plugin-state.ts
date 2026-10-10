import { AppError, ensure, errorMessage, isRecord } from '../../domain/shared/errors.ts';
import type { Workspace } from '../workspace/workspace.ts';

/** What the host remembers about an enabled plugin between invocations. */
export interface PluginStateEntry { settings: string | null }
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
  manifest: { id: string };
  onUserEnable?(context: C): void | Promise<void>;
  onExternalSettingsChange?(context: C): void | Promise<void>;
}

export const pluginStatePath = 'bin/data/plugins-state.json';
const tracked = (plugin: TrackedPlugin<unknown>) => typeof plugin.onUserEnable === 'function' || typeof plugin.onExternalSettingsChange === 'function';

/** Workspace data in `bin/data/plugins-state.json`, written with a revision guard; dry runs never persist. */
export class WorkspacePluginState implements PluginStateStore {
  private revision: string | undefined;
  private stored = '';
  constructor(
    private readonly workspace: Workspace,
    private readonly warn: (message: string) => void,
    private readonly settings: (pluginId: string) => Promise<string | null> = async () => null,
  ) {}
  settingsRevision(pluginId: string): Promise<string | null> { return this.settings(pluginId); }
  async load(): Promise<PluginStates> {
    let text: string;
    try {
      const snapshot = await this.workspace.files.read(pluginStatePath);
      this.revision = snapshot.revision;
      text = new TextDecoder('utf-8').decode(snapshot.bytes);
    } catch (error) {
      if (error instanceof AppError && error.code === 'NOT_FOUND') return {};
      throw error;
    }
    try {
      const value: unknown = JSON.parse(text);
      ensure(isRecord(value) && value.schemaVersion === 1 && isRecord(value.plugins), 'INVALID_PLUGIN', 'Unexpected plugin state shape.');
      const states: PluginStates = {};
      for (const [id, entry] of Object.entries(value.plugins)) {
        ensure(isRecord(entry) && (entry.settings === null || typeof entry.settings === 'string'), 'INVALID_PLUGIN', `Unexpected state for plugin ${id}.`);
        states[id] = { settings: entry.settings };
      }
      this.stored = serialize(states);
      return states;
    } catch {
      this.warn(`Ignored invalid ${pluginStatePath}; plugins with activation hooks are treated as newly enabled.`);
      return {};
    }
  }
  async save(states: PluginStates): Promise<void> {
    const content = serialize(states);
    if (this.workspace.dryRun || content === this.stored || (this.revision === undefined && Object.keys(states).length === 0)) return;
    await this.workspace.write([{ path: pluginStatePath, bytes: new TextEncoder().encode(content), ...(this.revision === undefined ? {} : { expectedRevision: this.revision }) }]);
    this.stored = content;
  }
}

function serialize(states: PluginStates): string {
  const plugins = Object.fromEntries(Object.keys(states).sort().map(id => [id, states[id]]));
  return JSON.stringify({ schemaVersion: 1, plugins }, null, 2) + '\n';
}

/**
 * Calls `onUserEnable` on the first activation after a plugin is enabled, and `onExternalSettingsChange`
 * when its settings revision changed since its last activation. Only plugins implementing a hook are tracked.
 */
export class ActivationTracker {
  private readonly next: PluginStates = {};
  private constructor(private readonly store: PluginStateStore, private readonly previous: PluginStates) {}
  static async load(store: PluginStateStore): Promise<ActivationTracker> { return new ActivationTracker(store, await store.load()); }

  async activated<C>(plugin: TrackedPlugin<C>, context: C): Promise<void> {
    if (!tracked(plugin as TrackedPlugin<unknown>)) return;
    const id = plugin.manifest.id, settings = await this.store.settingsRevision(id), entry = this.previous[id];
    const hook = entry === undefined ? 'onUserEnable' : entry.settings !== settings ? 'onExternalSettingsChange' : undefined;
    const result: unknown = hook ? await plugin[hook]?.(context) : undefined;
    ensure(result === undefined, 'INVALID_PLUGIN', `${hook} must return nothing.`);
    this.next[id] = { settings };
  }

  /** Keeps unreached enabled plugins' entries and forgets disabled plugins; a failed save is a warning. */
  async save(plugins: ReadonlyArray<TrackedPlugin<unknown>>, warn: (message: string) => void): Promise<void> {
    const states: PluginStates = {};
    for (const plugin of plugins.filter(tracked)) {
      const entry = this.next[plugin.manifest.id] ?? this.previous[plugin.manifest.id];
      if (entry) states[plugin.manifest.id] = entry;
    }
    try { await this.store.save(states); }
    catch (error) {
      try { warn(`Could not record plugin activation state in ${pluginStatePath}: ${errorMessage(error)}`); }
      catch { /* Diagnostics cannot replace the command result. */ }
    }
  }
}
