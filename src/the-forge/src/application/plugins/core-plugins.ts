import { ensure } from '../../domain/shared/errors.ts';
import type { EventBus } from './events.ts';
import type { PluginContributions, PluginManifest, Registry, Skill } from './registry.ts';

/** Read access to every registered skill: the kernel's, core plugins' and user plugins'. */
export interface SkillCatalog { list(): Skill[]; get(id: string): Skill | undefined }

/** A regular file's byte size and filesystem creation and modification dates. */
export interface FileDates { size: number; ctime: Date; mtime: Date }
/**
 * Reads file dates below an absolute command root (`context.root`) by root-relative vault path. Symlinks and
 * non-regular files are refused like repository reads; a missing file fails.
 */
export type FileDatesReader = (root: string) => (path: string) => Promise<FileDates>;

/**
 * Kernel services a bundled core plugin's factory receives from the composition root. A core plugin depends only
 * on these application ports and on domain contracts; it never imports kernel infrastructure or presentation, or
 * another plugin. Add a port here, and supply its adapter in `src/main.ts`, when a core plugin needs one.
 */
export interface CorePluginHost {
  skills: SkillCatalog;
  /** Filesystem dates, which the repository port does not carry (Bases `file.ctime`/`file.mtime`). */
  fileDates: FileDatesReader;
}

/**
 * A bundled core plugin: `src/plugins/<id>/plugin.ts` exports one. `create` wires the plugin's own layers with the
 * injected host services; it runs only when the plugin is enabled and must not perform I/O.
 */
export interface CorePlugin {
  manifest: PluginManifest & { core: true };
  create(host: CorePluginHost): PluginContributions;
}

/**
 * Registers the bundled core plugins in bundle order. They are enabled by default; ids in `disabled`
 * (`plugins.disabled`) are recorded as disabled and contribute nothing. A core plugin that requires a service no
 * enabled core plugin provides is disabled with it (disabling `bases` disables `backlog`, which requires
 * `bases.query`). Unknown ids are INVALID_PLUGIN_CONFIG.
 */
export function registerCorePlugins(registry: Registry, events: EventBus, plugins: readonly CorePlugin[], host: CorePluginHost, disabled: readonly string[]): void {
  const ids = plugins.map(plugin => plugin.manifest.id);
  const unknown = disabled.filter(id => !ids.includes(id));
  ensure(unknown.length === 0, 'INVALID_PLUGIN_CONFIG', `plugins.disabled names only bundled core plugins (${ids.join(', ')}); remove ${unknown.join(', ')}. Disable a user plugin by removing it from plugins.enabled.`);
  const enabled = new Map(plugins.filter(plugin => !disabled.includes(plugin.manifest.id)).map(plugin => [plugin, plugin.create(host)]));
  for (let changed = true; changed;) {
    const provided = new Set([...enabled.values()].flatMap(contributions => Object.keys(contributions.provides ?? {})));
    changed = false;
    for (const [plugin, contributions] of enabled) {
      if ((contributions.requires ?? []).some(service => !provided.has(service))) { enabled.delete(plugin); changed = true; }
    }
  }
  for (const plugin of plugins) {
    const contributions = enabled.get(plugin);
    if (contributions === undefined) registry.disable(plugin.manifest);
    else registry.register({ ...contributions, manifest: plugin.manifest }, events, 'core');
  }
}

/**
 * One installed user plugin directory under `bin/plugins` with a valid manifest. `skipped` means `plugins.enabled`
 * names it but `--no-plugins` left it unloaded; otherwise an unloaded user plugin is disabled.
 */
export interface InstalledPlugin { manifest: PluginManifest; skipped: boolean }

/** The skill catalog over the registry's live skill map. */
export function registrySkills(registry: Pick<Registry, 'skills'>): SkillCatalog {
  return { list: () => [...registry.skills.values()], get: id => registry.skills.get(id) };
}
