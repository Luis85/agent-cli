import type { Registry } from '../../application/plugins/registry.ts';
import type { InstalledPlugin } from '../../application/plugins/core-plugins.ts';
import { kernelMessage } from '../../domain/shared/kernel-messages.ts';
import { Localizer } from '../localization/localization.ts';

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
 * `localizer` renders reasons and, where plugins translate them, names and descriptions in the response language.
 */
export function pluginCatalog(registry: Registry, installed: readonly InstalledPlugin[], localizer: Localizer = new Localizer('en', registry.catalog)) {
  const loaded = registry.plugins.map(plugin => {
    const services = { provides: Object.keys(plugin.provides ?? {}), requires: [...plugin.requires ?? []], optional: [...plugin.optional ?? []] };
    const unavailable = registry.unavailable.get(plugin.manifest.id);
    return {
      ...localizer.manifest(plugin.manifest), core: registry.origins.get(plugin.manifest.id) === 'core',
      ...(unavailable ? { state: 'unavailable' as const, reason: localizer.warning(unavailable.reason) } : { state: 'enabled' as const, reason: null }),
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
  const disabledCore = registry.disabled.map(manifest => ({ ...localizer.manifest(manifest), core: true, state: 'disabled' as const, reason: localizer.warning(registry.disabledReason(manifest.id) ?? kernelMessage('PLUGIN_LISTED_DISABLED')), contributions: null }));
  const coreIds = new Set([...registry.disabled.map(manifest => manifest.id), ...[...registry.origins].filter(([, origin]) => origin === 'core').map(([id]) => id)]);
  const others = installed.filter(entry => coreIds.has(entry.manifest.id) || !registry.origins.has(entry.manifest.id)).map(entry => ({
    ...entry.manifest, core: false,
    ...(coreIds.has(entry.manifest.id)
      ? { state: 'rejected' as const, reason: localizer.warning(kernelMessage('PLUGIN_ID_RESERVED', { plugin: entry.manifest.id })) }
      : entry.skipped
        ? { state: 'skipped' as const, reason: localizer.warning(kernelMessage('PLUGIN_SKIPPED')) }
        : { state: 'disabled' as const, reason: localizer.warning(kernelMessage('PLUGIN_NOT_ENABLED')) }),
    contributions: null,
  }));
  // An enabled plugin without a manifest has no manifest fields to list; its id and reason say what to fix.
  const missing = [...registry.missing].map(([id, reason]) => ({ id, core: false, state: 'missing' as const, reason, contributions: null }));
  return [...loaded.filter(plugin => plugin.core), ...disabledCore, ...loaded.filter(plugin => !plugin.core), ...missing, ...others];
}
