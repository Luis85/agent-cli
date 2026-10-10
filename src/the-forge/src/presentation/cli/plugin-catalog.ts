import type { Registry } from '../../application/plugins/registry.ts';
import type { InstalledPlugin } from '../../application/plugins/core-plugins.ts';

/**
 * The `plugins` catalog: bundled core plugins first, then user plugins, with `state` and their contributions.
 * Disabled and unloaded plugins list their manifest and a `reason` only, since their code never ran in this invocation.
 */
export function pluginCatalog(registry: Registry, installed: readonly InstalledPlugin[]) {
  const loaded = registry.plugins.map(plugin => {
    const services = { provides: Object.keys(plugin.provides ?? {}), requires: [...plugin.requires ?? []] };
    return {
      ...plugin.manifest, core: registry.origins.get(plugin.manifest.id) === 'core', state: 'enabled' as const,
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
  const disabledCore = registry.disabled.map(manifest => ({ ...manifest, core: true, state: 'disabled' as const, reason: registry.disabledReason(manifest.id) ?? null, contributions: null }));
  const others = installed.filter(entry => !registry.origins.has(entry.manifest.id)).map(entry => ({
    ...entry.manifest, core: false, state: entry.skipped ? 'skipped' as const : 'disabled' as const,
    reason: entry.skipped ? 'Skipped by --no-plugins.' : 'Not listed in plugins.enabled.', contributions: null,
  }));
  return [...loaded.filter(plugin => plugin.core), ...disabledCore, ...loaded.filter(plugin => !plugin.core), ...others];
}
