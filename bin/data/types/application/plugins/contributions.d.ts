export type PluginOrigin = 'core' | 'user';
/**
 * Validates every contribution of one plugin before anything is registered. User plugins prefix command,
 * generator, skill, event and service ids with `<id>.` and error codes with `<ID>_`; bundled core plugins may
 * own bare command, generator, skill and service ids, while their events stay in their own `<id>.*` namespace.
 */
export declare function validateContributions(plugin: Record<string, unknown>, pluginId: string, origin: PluginOrigin): void;
