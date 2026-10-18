import { ensure } from '../../domain/shared/errors.ts';
import { isKernelMessage } from '../../domain/shared/kernel-messages.ts';
import { pluginWarning } from '../../domain/shared/warnings.ts';
import type { EventBus, EventChannel } from './events.ts';
import { hostEventNamespaces } from './host-events.ts';
import { errorPrefix } from './plugin-catalog.ts';

const isHostNamespace = (namespace: string) => (hostEventNamespaces as readonly string[]).includes(namespace);

/** Plugin ids name their event namespace, so a plugin cannot claim a host namespace. */
export function ensurePluginNamespace(pluginId: string): void {
  ensure(!isHostNamespace(pluginId), 'PLUGIN_NAMESPACE', `Plugin id ${pluginId} is reserved for host events (${hostEventNamespaces.join(', ')}).`);
}

/**
 * Whether a plugin's own warning code is in its namespace, as user plugin error codes are: it starts with the plugin
 * id in UPPER_SNAKE_CASE and `_` (`QUALITY_`), and no other plugin of `pluginIds` has a longer prefix of it, so plugin
 * `a` cannot use `A_B_STALE` while plugin `a-b` is registered.
 */
export function ownsWarningCode(pluginId: string, code: string, pluginIds: Iterable<string>): boolean {
  const prefix = errorPrefix(pluginId);
  return code.startsWith(prefix) && ![...pluginIds].some(other => errorPrefix(other).length > prefix.length && code.startsWith(errorPrefix(other)));
}

/**
 * The event channel handed to one plugin's lifecycle hooks and commands. It observes every event,
 * but emits only `<pluginId>.*` events: host events and other plugins' events stay with their owners. Its warnings
 * keep only codes in the plugin's namespace among the registered `pluginIds` (see `ownsWarningCode`).
 */
export function pluginEvents(bus: EventBus, pluginId: string, pluginIds: () => Iterable<string> = () => [pluginId]): EventChannel {
  const source = { id: pluginId, owns: (code: string) => ownsWarningCode(pluginId, code, pluginIds()) };
  return {
    ids: () => bus.ids(),
    catalog: () => bus.catalog(),
    on: (id, listener) => bus.on(id, listener),
    once: (id, listener) => bus.once(id, listener),
    onAny: listener => bus.onAny(listener),
    replay: listener => bus.replay(listener),
    // Plugins are plain JavaScript and may pass any value; it is reported with the plugin's id, as its own coded warning
    // or as PLUGIN_WARNING text. Only a message the host created with kernelMessage (which core plugins import from
    // the kernel domain) renders from the host catalog.
    warn: (message: unknown) => bus.warn(isKernelMessage(message) ? message : pluginWarning(message, source)),
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
