import type { Workspace } from '../workspace/workspace.ts';
import type { ProjectInfo } from '../projects/projects.ts';
import type { EventBus, EventChannel, EventDefinition } from './events.ts';
import type { WriteRequest } from '../../domain/documents/file.ts';
import type { ClaudeLifecycleClient } from '../claude/lifecycle.ts';
import type { MetadataIndex } from '../metadata/ports.ts';
import type { App } from '../vault/app.ts';
import type { GenerationService } from '../generation/plans.ts';
import type { JsonSchema } from '../../domain/schema/json-schema.ts';
import { ensure, isRecord, summarizeError, errorMessage } from '../../domain/shared/errors.ts';
import { publishHostEvent } from './host-events.ts';
import { ensurePluginNamespace, pluginEvents } from './ownership.ts';
import { ActivationTracker, type PluginStateStore } from './plugin-state.ts';
import type { CommandFlags, CommandMetadata, CommandMode, CommandOption } from './command-metadata.ts';
import { validateContributions, type PluginOrigin } from './contributions.ts';
import { activationOrder, pluginServices, serviceProviders, type PluginServices } from './plugin-services.ts';
import { PluginCatalog, type Language, type PluginErrorDefinition, type PluginStrings } from './plugin-catalog.ts';
import { PluginSettings } from './plugin-settings.ts';

/**
 * `workspace` is the command's scope (the selected project, or the workspace) and `environment` the workspace-root
 * scope, which workspace-scoped plugins use explicitly. `metadata` is the lazily built metadata index of the same
 * root as `workspace`; `app` is the Obsidian-shaped facade (vault, metadataCache, fileManager, workspace) over it.
 */
export interface CommandContext {
  workspace: Workspace; environment: Workspace; events: EventChannel; claude: ClaudeLifecycleClient; metadata: MetadataIndex; app: App;
  workspaceRoot: string; root: string; project: ProjectInfo | null; language: Language; input: () => Promise<Uint8Array>;
}
/** What a plugin's hooks, commands and generators receive: the command context plus its own settings, services and strings. */
export interface PluginContext extends CommandContext {
  /** The validated `plugins.settings.<id>` section with defaults, or null when the plugin declares no settings. */
  settings: Readonly<Record<string, unknown>> | null;
  services: PluginServices;
  /** The plugin's `strings.<language>.messages[key]`, falling back to English and then to the key. */
  t(key: string): string;
}
export interface Command extends CommandMetadata {
  run(args: string[], flags: CommandFlags, context: CommandContext): unknown | Promise<unknown>;
}
/** `directory` is the resolved output directory; `generation` plans, checks and commits reviewed output. */
export interface GeneratorRequest { name: string; directory: string; flags: CommandFlags; context: CommandContext; generation: GenerationService }
/**
 * `make <id> <Name>`. A `generate` generator returns a write plan the host previews or writes (with `review`, the
 * host also offers --plan, --plan-out, --check and --revisions-from); a `run` generator returns its own result.
 */
export interface Generator extends CommandMode {
  id: string; description: string; usage?: string;
  options?: Readonly<Record<string, CommandOption>>;
  /** Default output directory; with `fixedDirectory`, --out is rejected. */
  directory?: string; fixedDirectory?: boolean; review?: boolean;
  generate?(request: GeneratorRequest): readonly WriteRequest[] | Promise<readonly WriteRequest[]>;
  run?(request: GeneratorRequest): unknown | Promise<unknown>;
}
export interface Skill { id: string; content: string }
/** `core: true` marks a bundled core plugin; the loader rejects it for user plugins. */
export interface PluginManifest {
  id: string; name: string; version: string; minAppVersion: string; description: string; author: string; core?: true;
}
export interface PluginContributions {
  commands?: Command[]; generators?: Generator[]; events?: EventDefinition[]; skills?: Skill[];
  /** Services this plugin offers to plugins that require them, by service id. */
  provides?: Record<string, unknown>;
  /** Service ids this plugin needs; it activates after their providers. */
  requires?: string[];
  /** JSON Schema (type object) of the plugin's config section `plugins.settings.<id>`. */
  settings?: JsonSchema;
  strings?: PluginStrings;
  errors?: PluginErrorDefinition[];
  onload?(context: PluginContext): void | Promise<void>;
  /** Once, on the first activation after the plugin is enabled. Runs after `onload`. */
  onUserEnable?(context: PluginContext): void | Promise<void>;
  /** On activation, when the plugin's settings section changed since its previous activation. Runs after `onload`. */
  onExternalSettingsChange?(context: PluginContext): void | Promise<void>;
  onunload?(): void | Promise<void>;
}
export interface Plugin extends PluginContributions { manifest: PluginManifest }
const appVersion = [0, 1, 0];
export function validatePluginManifest(value: unknown, origin: PluginOrigin = 'user'): asserts value is PluginManifest {
  ensure(isRecord(value) && typeof value.id === 'string' && /^[a-z][a-z0-9-]*$/.test(value.id), 'INVALID_PLUGIN', 'Plugin manifest requires a lowercase kebab-case id.');
  ensurePluginNamespace(value.id);
  ensure(origin === 'core' ? value.core === true : value.core === undefined, 'PLUGIN_NAMESPACE', origin === 'core' ? `Bundled plugin ${value.id} must declare core: true.` : `Plugin ${value.id} cannot declare core; only bundled core plugins are core plugins.`);
  for (const key of ['name', 'description', 'author']) ensure(typeof value[key] === 'string' && value[key].trim().length > 0, 'INVALID_PLUGIN', `Plugin manifest requires ${key}.`);
  for (const key of ['version', 'minAppVersion']) ensure(typeof value[key] === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value[key]), 'INVALID_PLUGIN', `Plugin manifest requires a numeric ${key}.`);
  const minimum = (value.minAppVersion as string).split('.').map(Number);
  const firstDifference = minimum.findIndex((part, index) => part !== appVersion[index]);
  ensure(firstDifference === -1 || minimum[firstDifference]! < appVersion[firstDifference]!, 'INCOMPATIBLE_PLUGIN', `Plugin ${value.id} requires agent-cli ${value.minAppVersion} or newer.`);
}
export class Registry {
  readonly commands = new Map<string, Command>();
  readonly generators = new Map<string, Generator>();
  readonly skills = new Map<string, Skill>();
  readonly plugins: Plugin[] = [];
  /** Registered plugins with their origin, and bundled core plugins disabled in configuration. */
  readonly origins = new Map<string, PluginOrigin>();
  readonly disabled: PluginManifest[] = [];
  readonly catalog = new PluginCatalog();
  readonly settings = new PluginSettings();
  private cleanups: Array<{ pluginId: string; run: () => void | Promise<void> }> = [];
  private published = new Set<string>();
  private state: 'registering' | 'activating' | 'active' | 'failed' | 'disposed' = 'registering';
  add<T extends { id: string }>(map: Map<string, T>, item: T): void {
    ensure(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(item.id) && !map.has(item.id), 'DUPLICATE_OR_INVALID_ID', item.id);
    map.set(item.id, item);
  }
  register(plugin: Plugin, events: EventBus, origin: PluginOrigin = 'user'): void {
    ensure(this.state === 'registering', 'PLUGIN_LIFECYCLE', 'Plugins must register before activation.');
    ensure(isRecord(plugin), 'INVALID_PLUGIN', 'Plugin must export an object or class.');
    validatePluginManifest(plugin.manifest, origin);
    const pluginId = plugin.manifest.id;
    ensure(!this.origins.has(pluginId) && !this.disabled.some(manifest => manifest.id === pluginId), 'DUPLICATE_PLUGIN', pluginId);
    validateContributions(plugin as unknown as Record<string, unknown>, pluginId, origin);
    // Stage every capability before publishing any of them. Failed startup must
    // leave the registry and event bus exactly as they were before this plugin.
    const commands = new Map(this.commands), generators = new Map(this.generators), skills = new Map(this.skills);
    for (const command of plugin.commands ?? []) this.add(commands, command);
    for (const generator of plugin.generators ?? []) {
      // make parses one flag set for every generator, so a shared option name must keep one type.
      for (const [key, option] of Object.entries(generator.options ?? {})) {
        const clash = [...generators.values()].find(other => other.options?.[key] !== undefined && other.options[key]!.type !== option.type);
        ensure(!clash, 'INVALID_PLUGIN', `Generator ${generator.id} declares --${key} as ${option.type}, but ${clash?.id} declares it as ${clash?.options?.[key]?.type}.`);
      }
      this.add(generators, generator);
    }
    for (const skill of plugin.skills ?? []) this.add(skills, skill);
    serviceProviders([...this.plugins, plugin]);
    for (const entry of plugin.errors ?? []) ensure(!this.catalog.error(entry.code), 'DUPLICATE_OR_INVALID_ID', entry.code);
    events.defineAll(plugin.events ?? []);
    this.catalog.add(pluginId, plugin.strings, plugin.errors);
    if (plugin.settings) this.settings.declare(pluginId, plugin.settings);
    for (const command of plugin.commands ?? []) this.commands.set(command.id, this.ownedCommand(plugin, command, events));
    for (const generator of plugin.generators ?? []) this.generators.set(generator.id, this.ownedGenerator(plugin, generator, events));
    for (const skill of plugin.skills ?? []) this.skills.set(skill.id, skill);
    this.plugins.push(plugin);
    this.origins.set(pluginId, origin);
  }
  /** A bundled core plugin disabled in `plugins.disabled`: listed by `plugins`, contributing nothing. */
  disable(manifest: PluginManifest): void {
    validatePluginManifest(manifest, 'core');
    ensure(!this.origins.has(manifest.id) && !this.disabled.some(entry => entry.id === manifest.id), 'DUPLICATE_PLUGIN', manifest.id);
    this.disabled.push(manifest);
  }
  /** The context a plugin's hooks, commands and generators run with. */
  pluginContext(plugin: Plugin, context: CommandContext, events: EventBus): PluginContext {
    const pluginId = plugin.manifest.id;
    return {
      ...context, events: pluginEvents(events, pluginId), settings: this.settings.value(pluginId),
      services: pluginServices(plugin, serviceProviders(this.plugins)),
      t: key => this.catalog.message(pluginId, context.language, key),
    };
  }
  async publishRegistered(events: EventBus): Promise<void> {
    ensure(this.state !== 'disposed', 'PLUGIN_LIFECYCLE', 'Cannot publish registrations after disposal.');
    for (const plugin of this.plugins) {
      const pluginId = plugin.manifest.id;
      if (this.published.has(pluginId)) continue;
      this.published.add(pluginId);
      await publishHostEvent(events, 'plugin.registered', { pluginId });
    }
  }
  /**
   * Activates plugins after the providers of their required services. Each plugin's hooks receive its own
   * context. `state` enables onUserEnable/onExternalSettingsChange.
   */
  async activate(events: EventBus, context: CommandContext, state?: PluginStateStore): Promise<void> {
    ensure(this.state === 'registering', 'PLUGIN_LIFECYCLE', 'Plugins can activate only once per invocation.');
    this.state = 'activating';
    let tracker: ActivationTracker | undefined;
    try {
      await this.publishRegistered(events);
      const order = activationOrder(this.plugins);
      if (state && this.plugins.length > 0) tracker = await ActivationTracker.load(state);
      for (const plugin of order) {
        const pluginId = plugin.manifest.id, onunload = plugin.onunload;
        const pluginContext = this.pluginContext(plugin, context, events);
        this.cleanups.unshift({ pluginId, run: () => onunload?.call(plugin) });
        await publishHostEvent(events, 'plugin.activating', { pluginId });
        try {
          const result = await plugin.onload?.(pluginContext);
          ensure(result === undefined, 'INVALID_PLUGIN', 'onload must return nothing; use onunload for cleanup.');
          await tracker?.activated(plugin, pluginContext);
          await publishHostEvent(events, 'plugin.activated', { pluginId });
        } catch (error) {
          const failure = this.catalog.normalize(error);
          await publishHostEvent(events, 'plugin.activation-failed', { pluginId, error: summarizeError(failure) });
          throw failure;
        }
      }
      this.state = 'active';
    } catch (error) { this.state = 'failed'; throw error; }
    finally { await tracker?.save(this.plugins, message => events.warn(message)); }
  }
  async dispose(events: EventBus): Promise<void> {
    this.state = 'disposed';
    for (const cleanup of this.cleanups.splice(0)) {
      await publishHostEvent(events, 'plugin.unloading', { pluginId: cleanup.pluginId });
      try {
        await cleanup.run();
        await publishHostEvent(events, 'plugin.unloaded', { pluginId: cleanup.pluginId });
      } catch (error) {
        await publishHostEvent(events, 'plugin.unload-failed', { pluginId: cleanup.pluginId, error: summarizeError(error) });
        try { events.warn(`Plugin cleanup: ${errorMessage(error)}`); }
        catch { /* Diagnostics must not replace the primary result or stop remaining cleanup. */ }
      }
    }
    events.dispose();
  }

  /** Plugin commands run with their plugin's context, so they can emit only their own events; coded errors resolve through the catalog. */
  private ownedCommand(plugin: Plugin, command: Command, events: EventBus): Command {
    return {
      ...command,
      run: async (args, flags, context) => {
        try { return await command.run(args, flags, this.pluginContext(plugin, context, events)); }
        catch (error) { throw this.catalog.normalize(error); }
      },
    };
  }
  private ownedGenerator(plugin: Plugin, generator: Generator, events: EventBus): Generator {
    const owned = (call: (request: GeneratorRequest) => unknown) => async (request: GeneratorRequest) => {
      try { return await call({ ...request, context: this.pluginContext(plugin, request.context, events) }); }
      catch (error) { throw this.catalog.normalize(error); }
    };
    const { generate, run } = generator;
    return {
      ...generator,
      ...(generate ? { generate: owned(request => generate.call(generator, request)) as Generator['generate'] } : {}),
      ...(run ? { run: owned(request => run.call(generator, request)) } : {}),
    };
  }
}
