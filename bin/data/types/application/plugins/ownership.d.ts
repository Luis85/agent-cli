import type { EventBus, EventChannel } from './events.ts';
/** Plugin ids name their event namespace, so a plugin cannot claim a host namespace. */
export declare function ensurePluginNamespace(pluginId: string): void;
/**
 * Whether a plugin's own warning code is in its namespace, as user plugin error codes are: it starts with the plugin
 * id in UPPER_SNAKE_CASE and `_` (`QUALITY_`), and no other plugin of `pluginIds` has a longer prefix of it, so plugin
 * `a` cannot use `A_B_STALE` while plugin `a-b` is registered.
 */
export declare function ownsWarningCode(pluginId: string, code: string, pluginIds: Iterable<string>): boolean;
/**
 * The event channel handed to one plugin's lifecycle hooks and commands. It observes every event,
 * but emits only `<pluginId>.*` events: host events and other plugins' events stay with their owners. Its warnings
 * keep only codes in the plugin's namespace among the registered `pluginIds` (see `ownsWarningCode`).
 */
export declare function pluginEvents(bus: EventBus, pluginId: string, pluginIds?: () => Iterable<string>): EventChannel;
