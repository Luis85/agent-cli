import type { Workspace } from '../workspace/workspace.ts';
import type { ProjectInfo } from '../projects/projects.ts';
import type { EventBus, EventChannel, EventDefinition } from './events.ts';
import type { WriteRequest } from '../../domain/documents/file.ts';
import type { MetadataIndex } from '../metadata/ports.ts';
import type { App } from '../vault/app.ts';
import type { GenerationService } from '../generation/plans.ts';
import type { JsonSchema } from '../../domain/schema/json-schema.ts';
import { ensure, forgeError, isRecord, summarizeError, errorMessage } from '../../domain/shared/errors.ts';
import { publishHostEvent } from './host-events.ts';
import { ensurePluginNamespace, pluginEvents } from './ownership.ts';
import { ActivationTracker, type PluginStateStore } from './plugin-state.ts';
import type { CommandFlags, CommandMetadata, CommandMode, CommandOption } from './command-metadata.ts';
import { validateContributions, type PluginOrigin } from './contributions.ts';
import { activationOrder, pluginServices, serviceProviders, serviceView, type PluginServices } from './plugin-services.ts';
import { errorPrefix, PluginCatalog, type Language, type PluginErrorDefinition, type PluginStrings } from './plugin-catalog.ts';
import { PluginSettings } from './plugin-settings.ts';

/**
 * `workspace` is the command's scope (the selected project, or the workspace) and `environment` the workspace-root
 * scope, which workspace-scoped plugins use explicitly. `metadata` is the lazily built metadata index of the same
 * root as `workspace`; `app` is the Obsidian-shaped facade (vault, metadataCache, fileManager, workspace) over it.
 */
export interface CommandContext {
  workspace: Workspace; environment: Workspace; events: EventChannel; metadata: MetadataIndex; app: App;
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
/**
 * Options `make` owns for every generator: the output directory and the review controls of reviewed generators.
 * A plugin generator that declares one fails registration with PLUGIN_NAMESPACE.
 */
export const hostGeneratorOptions = ['out', 'plan', 'plan-out', 'check', 'revisions-from'] as const;
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
  /** Service ids this plugin uses when an enabled plugin provides them; it activates after those providers. */
  optional?: string[];
  /** JSON Schema (type object) of the plugin's config section `plugins.settings.<id>`. */
  settings?: JsonSchema;
  /**
   * Checks the schema-valid section (with defaults) beyond what JSON Schema expresses, such as glob syntax. Each
   * returned issue `<path>: <problem>` makes the section invalid like a schema violation. Runs without I/O.
   */
  validateSettings?(settings: Readonly<Record<string, unknown>>): readonly string[];
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
  /** Registered plugins with their origin. */
  readonly origins = new Map<string, PluginOrigin>();
  /** Bundled core plugins listed in `plugins.disabled`: they contribute nothing, and their commands are unknown. */
  readonly disabled: PluginManifest[] = [];
  private readonly disabledReasons = new Map<string, string>();
  readonly catalog = new PluginCatalog();
  readonly settings = new PluginSettings();
  /**
   * Registered plugins that cannot run in this invocation, with a `reason` sentence: an invalid settings section
   * (`issues` lists its problems), or a required service whose provider is disabled or itself unavailable (`issues`
   * are the provider's). They stay listed with their contributions but never activate; their commands and
   * generators fail with PLUGIN_UNAVAILABLE.
   */
  readonly unavailable = new Map<string, { reason: string; issues: string[] }>();
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
      const owned = Object.keys(generator.options ?? {}).filter(key => (hostGeneratorOptions as readonly string[]).includes(key));
      ensure(owned.length === 0, 'PLUGIN_NAMESPACE', `Generator ${generator.id} cannot declare --${owned.join(', --')}; make owns --${hostGeneratorOptions.join(', --')} for every generator.`);
      this.add(generators, generator);
    }
    for (const skill of plugin.skills ?? []) this.add(skills, skill);
    serviceProviders([...this.plugins, plugin]);
    const prefix = origin === 'core' ? null : errorPrefix(pluginId);
    this.catalog.ensureRegistrable(pluginId, plugin.errors, prefix);
    events.defineAll(plugin.events ?? []);
    this.catalog.add(pluginId, plugin.strings, plugin.errors, prefix);
    if (plugin.settings) this.settings.declare(pluginId, plugin.settings, plugin.validateSettings?.bind(plugin));
    for (const command of plugin.commands ?? []) this.commands.set(command.id, this.ownedCommand(plugin, command, events));
    for (const generator of plugin.generators ?? []) this.generators.set(generator.id, this.ownedGenerator(plugin, generator, events));
    for (const skill of plugin.skills ?? []) this.skills.set(skill.id, skill);
    this.plugins.push(plugin);
    this.origins.set(pluginId, origin);
  }
  /** A bundled core plugin listed in `plugins.disabled`: it contributes nothing and `plugins` lists it with `reason`. */
  disable(manifest: PluginManifest, reason: string): void {
    validatePluginManifest(manifest, 'core');
    ensure(!this.origins.has(manifest.id) && !this.disabled.some(entry => entry.id === manifest.id), 'DUPLICATE_PLUGIN', manifest.id);
    this.disabled.push(manifest);
    this.disabledReasons.set(manifest.id, reason);
  }
  /** Why a disabled core plugin contributes nothing. */
  disabledReason(pluginId: string): string | undefined { return this.disabledReasons.get(pluginId); }
  /** A registered command, including one of an unavailable plugin; any other id fails with UNKNOWN_COMMAND. */
  resolveCommand(commandId: string): Command {
    const command = this.commands.get(commandId);
    ensure(command, 'UNKNOWN_COMMAND', `Unknown command ${commandId}. Run help or schema.`);
    return command;
  }
  /**
   * Validates `plugins.settings` after registration and returns the effective sections. A plugin with an invalid
   * section becomes unavailable with a warning instead of failing the invocation, and so does every plugin that
   * requires its services; a plugin that requires a service of a disabled core plugin (`backlog` without `bases`)
   * becomes unavailable without a warning, since `plugins.disabled` asked for it. Discovery and recovery commands
   * keep working; only the unavailable plugins' commands and generators fail with PLUGIN_UNAVAILABLE. Sections of
   * loaded plugins without settings, and sections naming no registered, disabled or `installed` plugin (misspelled
   * ids), are kept unchanged with a warning.
   */
  async configure(sections: Readonly<Record<string, unknown>>, installed: () => Promise<readonly string[]>, warn: (message: string) => void): Promise<Record<string, unknown>> {
    const report = this.settings.configure(sections, new Set(this.origins.keys()));
    for (const [pluginId, issues] of report.invalid) this.unavailable.set(pluginId, { reason: `plugins.settings.${pluginId} is invalid: ${issues.join('; ')}.`, issues });
    this.cascadeUnavailable();
    for (const [pluginId, { reason, issues }] of this.unavailable) {
      if (issues.length > 0) warn(`Plugin ${pluginId} is unavailable in this invocation: ${reason} Its commands and generators fail with PLUGIN_UNAVAILABLE; fix bin/config.json and run config.`);
    }
    if (report.undeclared.length > 0) warn(`plugins.settings has sections for plugins that declare no settings: ${report.undeclared.join(', ')}; they are ignored.`);
    const foreign = Object.keys(sections).filter(id => !this.origins.has(id) && !this.disabled.some(manifest => manifest.id === id));
    const present = foreign.length > 0 ? new Set(await installed()) : new Set<string>();
    const unknown = foreign.filter(id => !present.has(id)).sort();
    if (unknown.length > 0) warn(`plugins.settings names no installed plugin: ${unknown.join(', ')}; the sections are kept unchanged. Check for misspelled plugin ids with plugins.`);
    return report.effective;
  }
  /**
   * A plugin service for a kernel command (`setup` uses `templates.installer`): the provider's read-only view, or
   * undefined when no registered plugin provides it or its provider is unavailable. Call it after `configure`.
   */
  service<T>(id: string): T | undefined {
    const provider = this.availableProviders().get(id);
    return provider === undefined ? undefined : serviceView<T>(provider, id);
  }
  /**
   * Like `service`, but a missing service fails with PLUGIN_UNAVAILABLE for `command` (`project create`), with
   * `details` `{command, plugin, service, reason, issues}`. The provider is the plugin the service id names.
   */
  requireService<T>(id: string, command: string): T {
    const service = this.service<T>(id);
    if (service !== undefined) return service;
    const pluginId = id.split('.')[0]!;
    const unavailable = this.unavailable.get(pluginId);
    const reason = unavailable?.reason ?? (this.disabled.some(manifest => manifest.id === pluginId) ? `Plugin ${pluginId} is disabled (plugins.disabled).` : `No enabled plugin provides service ${id}.`);
    throw forgeError('PLUGIN_UNAVAILABLE', `Command ${command} is unavailable because it needs service ${id} of plugin ${pluginId}: ${reason}`, { command, plugin: pluginId, service: id, reason, issues: unavailable?.issues ?? [] });
  }
  /** Marks every plugin unavailable whose required service has a disabled or unavailable provider, transitively. */
  private cascadeUnavailable(): void {
    const providers = serviceProviders(this.plugins);
    // Service ids start with their provider's plugin id (`bases.query`), which names a disabled provider.
    const blocked = (service: string): { reason: string; issues: string[] } | undefined => {
      const provider = providers.get(service)?.manifest.id;
      const unavailable = provider === undefined ? undefined : this.unavailable.get(provider);
      if (unavailable) return { reason: `Requires service ${service}; its provider ${provider} is unavailable.`, issues: unavailable.issues };
      const disabled = provider === undefined ? this.disabled.find(manifest => service.startsWith(`${manifest.id}.`)) : undefined;
      return disabled && { reason: `Requires service ${service}; its provider ${disabled.id} is disabled.`, issues: [] };
    };
    for (let changed = true; changed;) {
      changed = false;
      for (const plugin of this.plugins) {
        if (this.unavailable.has(plugin.manifest.id)) continue;
        const cause = (plugin.requires ?? []).map(blocked).find(entry => entry !== undefined);
        if (cause === undefined) continue;
        this.unavailable.set(plugin.manifest.id, cause);
        changed = true;
      }
    }
  }
  /**
   * The context a plugin's hooks, commands and generators run with. Unavailable plugins provide no services, so an
   * optional service whose provider is unavailable reads as absent (`services.has` is false).
   */
  pluginContext(plugin: Plugin, context: CommandContext, events: EventBus): PluginContext {
    const pluginId = plugin.manifest.id;
    return {
      ...context, events: pluginEvents(events, pluginId), settings: this.settings.value(pluginId),
      services: pluginServices(plugin, this.availableProviders()),
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
      const order = activationOrder(this.plugins.filter(plugin => !this.unavailable.has(plugin.manifest.id)));
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
          const failure = this.catalog.normalize(error, pluginId, this.serviceProviderIds(plugin));
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

  /** Service providers by service id among available plugins: an unavailable plugin provides nothing. */
  private availableProviders() { return serviceProviders(this.plugins.filter(entry => !this.unavailable.has(entry.manifest.id))); }
  /** The available plugins providing services that `plugin` requires or optionally uses; their error codes surface through it. */
  private serviceProviderIds(plugin: Plugin): string[] {
    const providers = this.availableProviders();
    return [...plugin.requires ?? [], ...plugin.optional ?? []].map(id => providers.get(id)?.manifest.id).filter((id): id is string => id !== undefined);
  }
  /** PLUGIN_UNAVAILABLE, with `details` `{command|generator, plugin, reason, issues}`, when the plugin cannot run. */
  private ensureAvailable(plugin: Plugin, contribution: { command: string } | { generator: string }): void {
    const unavailable = this.unavailable.get(plugin.manifest.id);
    if (!unavailable) return;
    const label = 'command' in contribution ? `Command ${contribution.command}` : `Generator ${contribution.generator}`;
    throw forgeError('PLUGIN_UNAVAILABLE', `${label} is unavailable because plugin ${plugin.manifest.id} is unavailable: ${unavailable.reason}`, { ...contribution, plugin: plugin.manifest.id, reason: unavailable.reason, issues: unavailable.issues });
  }
  /** Plugin commands run with their plugin's context, so they can emit only their own events; coded errors resolve through the catalog. */
  private ownedCommand(plugin: Plugin, command: Command, events: EventBus): Command {
    return {
      ...command,
      run: async (args, flags, context) => {
        this.ensureAvailable(plugin, { command: command.id });
        try { return await command.run(args, flags, this.pluginContext(plugin, context, events)); }
        catch (error) { throw this.catalog.normalize(error, plugin.manifest.id, this.serviceProviderIds(plugin)); }
      },
    };
  }
  private ownedGenerator(plugin: Plugin, generator: Generator, events: EventBus): Generator {
    const owned = (call: (request: GeneratorRequest) => unknown) => async (request: GeneratorRequest) => {
      this.ensureAvailable(plugin, { generator: generator.id });
      try { return await call({ ...request, context: this.pluginContext(plugin, request.context, events) }); }
      catch (error) { throw this.catalog.normalize(error, plugin.manifest.id, this.serviceProviderIds(plugin)); }
    };
    const { generate, run } = generator;
    return {
      ...generator,
      ...(generate ? { generate: owned(request => generate.call(generator, request)) as Generator['generate'] } : {}),
      ...(run ? { run: owned(request => run.call(generator, request)) } : {}),
    };
  }
}
