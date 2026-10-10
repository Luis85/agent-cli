import { ensure, forgeError } from '../../domain/shared/errors.ts';

/** What the service graph needs from a plugin: its id and declared `provides`/`requires`. */
export interface ServiceNode { manifest: { id: string }; provides?: Readonly<Record<string, unknown>>; requires?: readonly string[] }
/** Typed access to the services a plugin declared in `requires` (and its own `provides`). */
export interface PluginServices { get<T = unknown>(id: string): T }

/** Providers by service id; a second provider for one id fails registration. */
export function serviceProviders(nodes: readonly ServiceNode[]): Map<string, ServiceNode> {
  const providers = new Map<string, ServiceNode>();
  for (const node of nodes) for (const id of Object.keys(node.provides ?? {})) {
    ensure(!providers.has(id), 'DUPLICATE_OR_INVALID_ID', `Service ${id} is provided by ${providers.get(id)?.manifest.id} and ${node.manifest.id}.`);
    providers.set(id, node);
  }
  return providers;
}

/**
 * Activation order: every plugin after the providers of the services it requires, otherwise in registration
 * order. A required service without an enabled provider is PLUGIN_SERVICE_MISSING; a dependency cycle is
 * PLUGIN_SERVICE_CYCLE. Both name the plugins and services involved.
 */
export function activationOrder<T extends ServiceNode>(nodes: readonly T[]): T[] {
  const providers = serviceProviders(nodes);
  for (const node of nodes) for (const id of node.requires ?? []) {
    if (!providers.has(id)) throw forgeError('PLUGIN_SERVICE_MISSING', `Plugin ${node.manifest.id} requires service ${id}, which no enabled plugin provides.`, { plugin: node.manifest.id, service: id });
  }
  const ordered: T[] = [], state = new Map<T, 'visiting' | 'done'>();
  const visit = (node: T, path: string[]) => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'visiting') {
      const cycle = [...path.slice(path.indexOf(node.manifest.id)), node.manifest.id];
      throw forgeError('PLUGIN_SERVICE_CYCLE', `Plugin services form a cycle: ${cycle.join(' -> ')}.`, { plugins: cycle });
    }
    state.set(node, 'visiting');
    for (const id of node.requires ?? []) {
      const provider = providers.get(id) as T;
      if (provider !== node) visit(provider, [...path, node.manifest.id]);
    }
    state.set(node, 'done');
    ordered.push(node);
  };
  for (const node of nodes) visit(node, []);
  return ordered;
}

/** The lookup a plugin's context receives: only declared services, so dependencies stay visible in manifests. */
export function pluginServices(node: ServiceNode, providers: ReadonlyMap<string, ServiceNode>): PluginServices {
  return {
    get<T>(id: string): T {
      const declared = (node.requires ?? []).includes(id) || Object.hasOwn(node.provides ?? {}, id);
      ensure(declared, 'PLUGIN_SERVICE_MISSING', `Plugin ${node.manifest.id} must declare service ${id} in requires before using it.`, { plugin: node.manifest.id, service: id });
      const provider = providers.get(id);
      ensure(provider, 'PLUGIN_SERVICE_MISSING', `Plugin ${node.manifest.id} requires service ${id}, which no enabled plugin provides.`, { plugin: node.manifest.id, service: id });
      return provider.provides![id] as T;
    },
  };
}
