/** What the service graph needs from a plugin: its id and declared `provides`/`requires`. */
export interface ServiceNode {
    manifest: {
        id: string;
    };
    provides?: Readonly<Record<string, unknown>>;
    requires?: readonly string[];
}
/** Typed access to the services a plugin declared in `requires` (and its own `provides`). */
export interface PluginServices {
    get<T = unknown>(id: string): T;
}
/** Providers by service id; a second provider for one id fails registration. */
export declare function serviceProviders(nodes: readonly ServiceNode[]): Map<string, ServiceNode>;
/**
 * Activation order: every plugin after the providers of the services it requires, otherwise in registration
 * order. A required service without an enabled provider is PLUGIN_SERVICE_MISSING; a dependency cycle is
 * PLUGIN_SERVICE_CYCLE. Both name the plugins and services involved.
 */
export declare function activationOrder<T extends ServiceNode>(nodes: readonly T[]): T[];
/** The lookup a plugin's context receives: only declared services, so dependencies stay visible in manifests. */
export declare function pluginServices(node: ServiceNode, providers: ReadonlyMap<string, ServiceNode>): PluginServices;
