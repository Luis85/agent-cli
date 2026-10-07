import type { Workspace } from './workspace.ts';
import type { EventBus, EventDefinition } from './events.ts';
import type { WriteRequest } from '../domain/file.ts';
import { ensure } from '../domain/errors.ts';

export interface CommandContext { workspace: Workspace; events: EventBus; root: string; input: () => Promise<Uint8Array> }
export interface Command {
  id: string; description: string; usage: string;
  options?: Record<string, 'string' | 'boolean'>;
  run(args: string[], flags: Record<string, string | boolean>, context: CommandContext): unknown | Promise<unknown>;
}
export interface Generator { id: string; description: string; generate(name: string, directory: string): readonly WriteRequest[] | Promise<readonly WriteRequest[]> }
export interface Skill { id: string; content: string }
export interface Plugin {
  manifest: { id: string; version: string; apiVersion: 1 };
  commands?: Command[]; generators?: Generator[]; events?: EventDefinition[]; skills?: Skill[];
  activate?(context: CommandContext): void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
}
export class Registry {
  readonly commands = new Map<string, Command>();
  readonly generators = new Map<string, Generator>();
  readonly skills = new Map<string, Skill>();
  readonly plugins: Plugin[] = [];
  private cleanups: Array<() => void | Promise<void>> = [];
  add<T extends { id: string }>(map: Map<string, T>, item: T): void {
    ensure(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(item.id) && !map.has(item.id), 'DUPLICATE_OR_INVALID_ID', item.id);
    map.set(item.id, item);
  }
  register(plugin: Plugin, events: EventBus): void {
    ensure(plugin?.manifest?.apiVersion === 1 && /^[a-z][a-z0-9-]*$/.test(plugin.manifest.id) && /^\d+\.\d+\.\d+$/.test(plugin.manifest.version), 'INVALID_PLUGIN', 'Plugin requires an id, semver version, and apiVersion: 1.');
    ensure(!this.plugins.some(p => p.manifest.id === plugin.manifest.id), 'DUPLICATE_PLUGIN', plugin.manifest.id);
    const owned = (id: string) => ensure(id.startsWith(plugin.manifest.id + '.'), 'PLUGIN_NAMESPACE', `Contribution ${id} must start with ${plugin.manifest.id}.`);
    for (const command of plugin.commands ?? []) {
      owned(command.id);
      ensure(typeof command.run === 'function' && typeof command.description === 'string' && typeof command.usage === 'string', 'INVALID_PLUGIN', 'Invalid command.');
      for (const [key, type] of Object.entries(command.options ?? {})) ensure(/^[a-z][a-z0-9-]*$/.test(key) && !['root', 'json', 'dry-run', 'plugins', 'help', 'version'].includes(key) && ['boolean', 'string'].includes(type), 'INVALID_PLUGIN', `Invalid command option ${key}.`);
      this.add(this.commands, command);
    }
    for (const generator of plugin.generators ?? []) { owned(generator.id); ensure(typeof generator.generate === 'function', 'INVALID_PLUGIN', 'Invalid generator.'); this.add(this.generators, generator); }
    for (const event of plugin.events ?? []) { owned(event.id); events.define(event); }
    for (const skill of plugin.skills ?? []) { owned(skill.id); ensure(typeof skill.content === 'string', 'INVALID_PLUGIN', 'Invalid skill.'); this.add(this.skills, skill); }
    this.plugins.push(plugin);
  }
  async activate(context: CommandContext): Promise<void> {
    for (const plugin of this.plugins) {
      const cleanup = await plugin.activate?.(context);
      ensure(cleanup === undefined || typeof cleanup === 'function', 'INVALID_PLUGIN', 'activate must return a cleanup function or nothing.');
      if (cleanup) this.cleanups.unshift(cleanup);
    }
  }
  async dispose(events: EventBus): Promise<void> {
    for (const cleanup of this.cleanups.splice(0)) {
      try { await cleanup(); } catch (error) { events.warn(`Plugin cleanup: ${String(error)}`); }
    }
    events.dispose();
  }
}
