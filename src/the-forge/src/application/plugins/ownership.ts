import { ensure } from '../../domain/shared/errors.ts';
import type { EventBus, EventChannel } from './events.ts';
import { hostEventNamespaces } from './host-events.ts';

const isHostNamespace = (namespace: string) => (hostEventNamespaces as readonly string[]).includes(namespace);

/** Plugin ids name their event namespace, so a plugin cannot claim a host namespace. */
export function ensurePluginNamespace(pluginId: string): void {
  ensure(!isHostNamespace(pluginId), 'PLUGIN_NAMESPACE', `Plugin id ${pluginId} is reserved for host events (${hostEventNamespaces.join(', ')}).`);
}

/**
 * The event channel handed to one plugin's lifecycle hooks and commands. It observes every event,
 * but emits only `<pluginId>.*` events: host events and other plugins' events stay with their owners.
 */
export function pluginEvents(bus: EventBus, pluginId: string): EventChannel {
  return {
    ids: () => bus.ids(),
    catalog: () => bus.catalog(),
    on: (id, listener) => bus.on(id, listener),
    once: (id, listener) => bus.once(id, listener),
    onAny: listener => bus.onAny(listener),
    replay: listener => bus.replay(listener),
    warn: message => bus.warn(message),
    onLayoutReady: callback => bus.onLayoutReady(callback),
    onQuit: task => bus.onQuit(task),
    async emit(id, payload) {
      const namespace = typeof id === 'string' ? id.split('.')[0]! : '';
      const owner = isHostNamespace(namespace) ? 'the host' : `plugin ${namespace}`;
      ensure(namespace === pluginId, 'EVENT_OWNERSHIP', `Plugin ${pluginId} may emit only ${pluginId}.* events; ${String(id)} belongs to ${owner}.`);
      await bus.emit(id, payload);
    },
  };
}
