import type { EventBus, EventChannel } from './events.ts';
/** Plugin ids name their event namespace, so a plugin cannot claim a host namespace. */
export declare function ensurePluginNamespace(pluginId: string): void;
/**
 * The event channel handed to one plugin's lifecycle hooks and commands. It observes every event,
 * but emits only `<pluginId>.*` events: host events and other plugins' events stay with their owners.
 */
export declare function pluginEvents(bus: EventBus, pluginId: string): EventChannel;
