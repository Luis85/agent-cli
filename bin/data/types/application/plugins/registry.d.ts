import type { Workspace } from '../workspace/workspace.ts';
import type { ProjectInfo } from '../projects/projects.ts';
import type { EventBus, EventChannel, EventDefinition } from './events.ts';
import type { WriteRequest } from '../../domain/documents/file.ts';
import type { ClaudeLifecycleClient } from '../claude/lifecycle.ts';
import type { MetadataIndex } from '../metadata/ports.ts';
import { type PluginStateStore } from './plugin-state.ts';
/** `metadata` is the lazily built metadata index of the same root as `workspace`. */
export interface CommandContext {
    workspace: Workspace;
    events: EventChannel;
    claude: ClaudeLifecycleClient;
    metadata: MetadataIndex;
    workspaceRoot: string;
    root: string;
    project: ProjectInfo | null;
    input: () => Promise<Uint8Array>;
}
export interface Command {
    id: string;
    description: string;
    usage: string;
    options?: Record<string, 'string' | 'boolean'>;
    run(args: string[], flags: Record<string, string | boolean>, context: CommandContext): unknown | Promise<unknown>;
}
export interface Generator {
    id: string;
    description: string;
    generate(name: string, directory: string): readonly WriteRequest[] | Promise<readonly WriteRequest[]>;
}
export interface Skill {
    id: string;
    content: string;
}
export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    minAppVersion: string;
    description: string;
    author: string;
}
export interface PluginContributions {
    commands?: Command[];
    generators?: Generator[];
    events?: EventDefinition[];
    skills?: Skill[];
    onload?(context: CommandContext): void | Promise<void>;
    /** Once, on the first activation after the plugin id is added to `plugins.enabled`. Runs after `onload`. */
    onUserEnable?(context: CommandContext): void | Promise<void>;
    /** On activation, when the plugin's settings changed since its previous activation. Runs after `onload`. */
    onExternalSettingsChange?(context: CommandContext): void | Promise<void>;
    onunload?(): void | Promise<void>;
}
export interface Plugin extends PluginContributions {
    manifest: PluginManifest;
}
export declare function validatePluginManifest(value: unknown): asserts value is PluginManifest;
export declare class Registry {
    readonly commands: Map<string, Command>;
    readonly generators: Map<string, Generator>;
    readonly skills: Map<string, Skill>;
    readonly plugins: Plugin[];
    private cleanups;
    private published;
    private state;
    add<T extends {
        id: string;
    }>(map: Map<string, T>, item: T): void;
    register(plugin: Plugin, events: EventBus): void;
    publishRegistered(events: EventBus): Promise<void>;
    /** Each plugin's hooks receive `context` with its own event channel. `state` enables onUserEnable/onExternalSettingsChange. */
    activate(events: EventBus, context: CommandContext, state?: PluginStateStore): Promise<void>;
    dispose(events: EventBus): Promise<void>;
}
