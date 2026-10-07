import type { Workspace } from './workspace.ts';
import type { EventBus, EventDefinition } from './events.ts';
import type { WriteRequest } from '../domain/file.ts';
export interface CommandContext {
    workspace: Workspace;
    events: EventBus;
    root: string;
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
    private state;
    add<T extends {
        id: string;
    }>(map: Map<string, T>, item: T): void;
    register(plugin: Plugin, events: EventBus): void;
    activate(context: CommandContext): Promise<void>;
    dispose(events: EventBus): Promise<void>;
}
