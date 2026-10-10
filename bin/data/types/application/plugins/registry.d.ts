import type { Workspace } from '../workspace/workspace.ts';
import type { ProjectInfo } from '../projects/projects.ts';
import type { EventBus, EventChannel, EventDefinition } from './events.ts';
import type { WriteRequest } from '../../domain/documents/file.ts';
import type { ClaudeLifecycleClient } from '../claude/lifecycle.ts';
import type { MetadataIndex } from '../metadata/ports.ts';
import type { App } from '../vault/app.ts';
import type { GenerationService } from '../generation/plans.ts';
import type { JsonSchema } from '../../domain/schema/json-schema.ts';
import { type PluginStateStore } from './plugin-state.ts';
import type { CommandFlags, CommandMetadata, CommandMode, CommandOption } from './command-metadata.ts';
import { type PluginOrigin } from './contributions.ts';
import { type PluginServices } from './plugin-services.ts';
import { PluginCatalog, type Language, type PluginErrorDefinition, type PluginStrings } from './plugin-catalog.ts';
import { PluginSettings } from './plugin-settings.ts';
/**
 * `workspace` is the command's scope (the selected project, or the workspace) and `environment` the workspace-root
 * scope, which workspace-scoped plugins use explicitly. `metadata` is the lazily built metadata index of the same
 * root as `workspace`; `app` is the Obsidian-shaped facade (vault, metadataCache, fileManager, workspace) over it.
 */
export interface CommandContext {
    workspace: Workspace;
    environment: Workspace;
    events: EventChannel;
    claude: ClaudeLifecycleClient;
    metadata: MetadataIndex;
    app: App;
    workspaceRoot: string;
    root: string;
    project: ProjectInfo | null;
    language: Language;
    input: () => Promise<Uint8Array>;
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
export interface GeneratorRequest {
    name: string;
    directory: string;
    flags: CommandFlags;
    context: CommandContext;
    generation: GenerationService;
}
/**
 * `make <id> <Name>`. A `generate` generator returns a write plan the host previews or writes (with `review`, the
 * host also offers --plan, --plan-out, --check and --revisions-from); a `run` generator returns its own result.
 */
export interface Generator extends CommandMode {
    id: string;
    description: string;
    usage?: string;
    options?: Readonly<Record<string, CommandOption>>;
    /** Default output directory; with `fixedDirectory`, --out is rejected. */
    directory?: string;
    fixedDirectory?: boolean;
    review?: boolean;
    generate?(request: GeneratorRequest): readonly WriteRequest[] | Promise<readonly WriteRequest[]>;
    run?(request: GeneratorRequest): unknown | Promise<unknown>;
}
/**
 * Options `make` owns for every generator: the output directory and the review controls of reviewed generators.
 * A plugin generator that declares one fails registration with PLUGIN_NAMESPACE.
 */
export declare const hostGeneratorOptions: readonly ["out", "plan", "plan-out", "check", "revisions-from"];
export interface Skill {
    id: string;
    content: string;
}
/** `core: true` marks a bundled core plugin; the loader rejects it for user plugins. */
export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    minAppVersion: string;
    description: string;
    author: string;
    core?: true;
}
export interface PluginContributions {
    commands?: Command[];
    generators?: Generator[];
    events?: EventDefinition[];
    skills?: Skill[];
    /** Services this plugin offers to plugins that require them, by service id. */
    provides?: Record<string, unknown>;
    /** Service ids this plugin needs; it activates after their providers. */
    requires?: string[];
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
export interface Plugin extends PluginContributions {
    manifest: PluginManifest;
}
export declare function validatePluginManifest(value: unknown, origin?: PluginOrigin): asserts value is PluginManifest;
export declare class Registry {
    readonly commands: Map<string, Command>;
    readonly generators: Map<string, Generator>;
    readonly skills: Map<string, Skill>;
    readonly plugins: Plugin[];
    /** Registered plugins with their origin, and bundled core plugins disabled in configuration. */
    readonly origins: Map<string, PluginOrigin>;
    readonly disabled: PluginManifest[];
    readonly catalog: PluginCatalog;
    readonly settings: PluginSettings;
    /**
     * Registered plugins that cannot run in this invocation, with the reason: an invalid settings section, or a
     * required service whose provider is itself unavailable. They stay listed but never activate.
     */
    readonly unavailable: Map<string, {
        reason: string;
        issues: string[];
    }>;
    private cleanups;
    private published;
    private state;
    add<T extends {
        id: string;
    }>(map: Map<string, T>, item: T): void;
    register(plugin: Plugin, events: EventBus, origin?: PluginOrigin): void;
    /** A bundled core plugin disabled in `plugins.disabled`: listed by `plugins`, contributing nothing. */
    disable(manifest: PluginManifest): void;
    /**
     * Validates `plugins.settings` after registration and returns the effective sections. A plugin with an invalid
     * section, and every plugin that requires its services, becomes unavailable with a warning instead of failing the
     * invocation: discovery and recovery commands keep working, and only its own commands and generators fail with
     * INVALID_CONFIG. Sections of loaded plugins without settings, and sections naming no registered, disabled or
     * `installed` plugin (misspelled ids), are kept unchanged with a warning.
     */
    configure(sections: Readonly<Record<string, unknown>>, installed: () => Promise<readonly string[]>, warn: (message: string) => void): Promise<Record<string, unknown>>;
    /** The context a plugin's hooks, commands and generators run with. */
    pluginContext(plugin: Plugin, context: CommandContext, events: EventBus): PluginContext;
    publishRegistered(events: EventBus): Promise<void>;
    /**
     * Activates plugins after the providers of their required services. Each plugin's hooks receive its own
     * context. `state` enables onUserEnable/onExternalSettingsChange.
     */
    activate(events: EventBus, context: CommandContext, state?: PluginStateStore): Promise<void>;
    dispose(events: EventBus): Promise<void>;
    /** INVALID_CONFIG when the plugin is unavailable in this invocation. */
    private ensureAvailable;
    /** Plugin commands run with their plugin's context, so they can emit only their own events; coded errors resolve through the catalog. */
    private ownedCommand;
    private ownedGenerator;
}
