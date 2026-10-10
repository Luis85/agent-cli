import type { Registry } from '../../application/plugins/registry.ts';
import type { InstalledPlugin } from '../../application/plugins/core-plugins.ts';

/**
 * The `plugins` catalog: bundled core plugins first, then user plugins, each with `state`, `reason` and its
 * contributions. `state` is one of:
 * - `enabled`: registered and runnable; `reason` is null.
 * - `unavailable`: registered, but its settings section is invalid or a service it requires has a disabled or
 *   unavailable provider; it lists its contributions, and they fail with PLUGIN_UNAVAILABLE.
 * - `disabled`: a core plugin in `plugins.disabled`, or an installed user plugin that `plugins.enabled` omits.
 * - `skipped`: an enabled user plugin that `--no-plugins` left unloaded.
 * - `rejected`: an installed user plugin whose id a bundled core plugin owns, enabled or disabled; it never loads
 *   and is listed separately from the core entry.
 * Every state but `enabled` carries a `reason` sentence. Plugins whose code never ran list `contributions: null`.
 */
export function pluginCatalog(registry: Registry, installed: readonly InstalledPlugin[]) {
  const loaded = registry.plugins.map(plugin => {
    const services = { provides: Object.keys(plugin.provides ?? {}), requires: [...plugin.requires ?? []] };
    const unavailable = registry.unavailable.get(plugin.manifest.id);
    return {
      ...plugin.manifest, core: registry.origins.get(plugin.manifest.id) === 'core',
      ...(unavailable ? { state: 'unavailable' as const, reason: unavailable.reason } : { state: 'enabled' as const, reason: null }),
      contributions: {
        commands: (plugin.commands ?? []).map(command => command.id),
        generators: (plugin.generators ?? []).map(generator => generator.id),
        events: (plugin.events ?? []).map(event => event.id),
        skills: (plugin.skills ?? []).map(skill => skill.id),
        services,
        settings: plugin.settings ? `plugins.settings.${plugin.manifest.id}` : null,
        strings: Object.keys(plugin.strings ?? {}).sort(),
        errors: (plugin.errors ?? []).map(error => error.code),
      },
    };
  });
  const disabledCore = registry.disabled.map(manifest => ({ ...manifest, core: true, state: 'disabled' as const, reason: registry.disabledReason(manifest.id) ?? 'Listed in plugins.disabled.', contributions: null }));
  const coreIds = new Set([...registry.disabled.map(manifest => manifest.id), ...[...registry.origins].filter(([, origin]) => origin === 'core').map(([id]) => id)]);
  const others = installed.filter(entry => coreIds.has(entry.manifest.id) || !registry.origins.has(entry.manifest.id)).map(entry => ({
    ...entry.manifest, core: false,
    ...(coreIds.has(entry.manifest.id)
      ? { state: 'rejected' as const, reason: `Plugin id ${entry.manifest.id} is reserved by the bundled core plugin; rename the user plugin.` }
      : entry.skipped
        ? { state: 'skipped' as const, reason: 'Skipped by --no-plugins.' }
        : { state: 'disabled' as const, reason: 'Not listed in plugins.enabled.' }),
    contributions: null,
  }));
  return [...loaded.filter(plugin => plugin.core), ...disabledCore, ...loaded.filter(plugin => !plugin.core), ...others];
}
