import { ensure, errorMessage } from '../../domain/shared/errors.ts';
import type { EventBus, EventChannel } from './events.ts';
import { hostEventNamespaces } from './host-events.ts';

const isHostNamespace = (namespace: string) => (hostEventNamespaces as readonly string[]).includes(namespace);

/** Plugin ids name their event namespace, so a plugin cannot claim a host namespace. */
export function ensurePluginNamespace(pluginId: string): void {
  ensure(!isHostNamespace(pluginId), 'PLUGIN_NAMESPACE', `Plugin id ${pluginId} is reserved for host events (${hostEventNamespaces.join(', ')}).`);
}

/**
 * A plugin warning as the text the response reports. Plugins are plain JavaScript and may pass any value: an error
 * reports its message, a plain object its JSON. Only the host emits coded kernel messages, so a plugin value that
 * looks like one stays literal text and is never rendered from the host catalog.
 */
function pluginWarningText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error || typeof value !== 'object' || value === null) return errorMessage(value);
  try { return JSON.stringify(value) ?? errorMessage(value); }
  catch { return errorMessage(value); }
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
    warn: (message: unknown) => bus.warn(pluginWarningText(message)),
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
