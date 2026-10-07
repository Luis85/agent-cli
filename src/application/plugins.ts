import type { Workspace } from './workspace.ts';
import type { ProjectInfo } from './projects.ts';
import type { EventBus, EventDefinition } from './events.ts';
import type { WriteRequest } from '../domain/file.ts';
import { ensure, isRecord } from '../domain/errors.ts';

export interface CommandContext { workspace: Workspace; events: EventBus; workspaceRoot: string; root: string; project: ProjectInfo | null; input: () => Promise<Uint8Array> }
export interface Command {
  id: string; description: string; usage: string;
  options?: Record<string, 'string' | 'boolean'>;
  run(args: string[], flags: Record<string, string | boolean>, context: CommandContext): unknown | Promise<unknown>;
}
export interface Generator { id: string; description: string; generate(name: string, directory: string): readonly WriteRequest[] | Promise<readonly WriteRequest[]> }
export interface Skill { id: string; content: string }
export interface PluginManifest {
  id: string; name: string; version: string; minAppVersion: string; description: string; author: string;
}
export interface PluginContributions {
  commands?: Command[]; generators?: Generator[]; events?: EventDefinition[]; skills?: Skill[];
  onload?(context: CommandContext): void | Promise<void>;
  onunload?(): void | Promise<void>;
}
export interface Plugin extends PluginContributions { manifest: PluginManifest }
const appVersion = [0, 1, 0];
export function validatePluginManifest(value: unknown): asserts value is PluginManifest {
  ensure(isRecord(value) && typeof value.id === 'string' && /^[a-z][a-z0-9-]*$/.test(value.id), 'INVALID_PLUGIN', 'Plugin manifest requires a lowercase kebab-case id.');
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
  private cleanups: Array<() => void | Promise<void>> = [];
  private state: 'registering' | 'activating' | 'active' | 'failed' | 'disposed' = 'registering';
  add<T extends { id: string }>(map: Map<string, T>, item: T): void {
    ensure(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(item.id) && !map.has(item.id), 'DUPLICATE_OR_INVALID_ID', item.id);
    map.set(item.id, item);
  }
  register(plugin: Plugin, events: EventBus): void {
    ensure(this.state === 'registering', 'PLUGIN_LIFECYCLE', 'Plugins must register before activation.');
    ensure(isRecord(plugin), 'INVALID_PLUGIN', 'Plugin must export an object or class.');
    validatePluginManifest(plugin.manifest);
    ensure(!this.plugins.some(p => p.manifest.id === plugin.manifest.id), 'DUPLICATE_PLUGIN', plugin.manifest.id);
    for (const hook of ['onload', 'onunload'] as const) ensure(plugin[hook] === undefined || typeof plugin[hook] === 'function', 'INVALID_PLUGIN', `${hook} must be a function.`);
    for (const key of ['commands', 'generators', 'events', 'skills'] as const) {
      ensure(plugin[key] === undefined || Array.isArray(plugin[key]), 'INVALID_PLUGIN', `${key} must be an array.`);
      for (const contribution of plugin[key] ?? []) {
        ensure(isRecord(contribution) && typeof contribution.id === 'string', 'INVALID_PLUGIN', `Invalid ${key} contribution.`);
        ensure(contribution.id.startsWith(plugin.manifest.id + '.'), 'PLUGIN_NAMESPACE', `Contribution ${contribution.id} must start with ${plugin.manifest.id}.`);
      }
    }
    // Stage every capability before publishing any of them. Failed startup must
    // leave the registry and event bus exactly as they were before this plugin.
    const commands = new Map(this.commands), generators = new Map(this.generators), skills = new Map(this.skills);
    for (const command of plugin.commands ?? []) {
      ensure(typeof command.run === 'function' && typeof command.description === 'string' && typeof command.usage === 'string', 'INVALID_PLUGIN', 'Invalid command.');
      ensure(command.options === undefined || isRecord(command.options), 'INVALID_PLUGIN', 'Command options must be an object.');
      for (const [key, type] of Object.entries(command.options ?? {})) ensure(/^[a-z][a-z0-9-]*$/.test(key) && !['root', 'lang', 'json', 'no-json', 'dry-run', 'no-dry-run', 'no-plugins', 'help', 'version'].includes(key) && ['boolean', 'string'].includes(type), 'INVALID_PLUGIN', `Invalid command option ${key}.`);
      this.add(commands, command);
    }
    for (const generator of plugin.generators ?? []) {
      ensure(typeof generator.generate === 'function' && typeof generator.description === 'string', 'INVALID_PLUGIN', 'Invalid generator.');
      this.add(generators, generator);
    }
    for (const skill of plugin.skills ?? []) {
      ensure(typeof skill.content === 'string', 'INVALID_PLUGIN', 'Invalid skill.');
      this.add(skills, skill);
    }
    events.defineAll(plugin.events ?? []);
    for (const command of plugin.commands ?? []) this.commands.set(command.id, command);
    for (const generator of plugin.generators ?? []) this.generators.set(generator.id, generator);
    for (const skill of plugin.skills ?? []) this.skills.set(skill.id, skill);
    this.plugins.push(plugin);
  }
  async activate(context: CommandContext): Promise<void> {
    ensure(this.state === 'registering', 'PLUGIN_LIFECYCLE', 'Plugins can activate only once per invocation.');
    this.state = 'activating';
    try {
      for (const plugin of this.plugins) {
        if (plugin.onunload) this.cleanups.unshift(() => plugin.onunload!());
        const result = await plugin.onload?.(context);
        ensure(result === undefined, 'INVALID_PLUGIN', 'onload must return nothing; use onunload for cleanup.');
      }
      this.state = 'active';
    } catch (error) { this.state = 'failed'; throw error; }
  }
  async dispose(events: EventBus): Promise<void> {
    this.state = 'disposed';
    for (const cleanup of this.cleanups.splice(0)) {
      try { await cleanup(); } catch (error) { events.warn(`Plugin cleanup: ${String(error)}`); }
    }
    events.dispose();
  }
}
