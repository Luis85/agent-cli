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
export interface Plugin {
    manifest: {
        id: string;
        version: string;
        apiVersion: 1;
    };
    commands?: Command[];
    generators?: Generator[];
    events?: EventDefinition[];
    skills?: Skill[];
    activate?(context: CommandContext): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
}
export declare class Registry {
    readonly commands: Map<string, Command>;
    readonly generators: Map<string, Generator>;
    readonly skills: Map<string, Skill>;
    readonly plugins: Plugin[];
    private cleanups;
    add<T extends {
        id: string;
    }>(map: Map<string, T>, item: T): void;
    register(plugin: Plugin, events: EventBus): void;
    activate(context: CommandContext): Promise<void>;
    dispose(events: EventBus): Promise<void>;
}
