import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { Registry, type CommandContext, type PluginManifest } from '../../src/application/plugins/registry.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import type { JsonSchema } from '../../src/domain/schema/json-schema.ts';

const manifest = (id: string): PluginManifest => ({ id, name: id, version: '1.0.0', minAppVersion: '0.1.0', description: 'Availability test', author: 'Test' });
const setup = () => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  return { registry, events };
};
const context = { language: 'en' } as unknown as CommandContext;
const limit = { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, default: 5 }, tags: { type: 'array', items: { type: 'string' }, default: ['a'] } } } as const;

describe('plugins with invalid settings', () => {
  it('become unavailable with a warning, together with plugins that require their services, while others activate', async () => {
    const { registry, events } = setup(), activated: string[] = [];
    registry.register({ manifest: manifest('catalog'), settings: limit, provides: { 'catalog.items': { list: () => [] } }, onload() { activated.push('catalog'); }, commands: [{ id: 'catalog.list', description: 'List', usage: 'catalog.list', run: () => [] }] }, events);
    registry.register({ manifest: manifest('board'), requires: ['catalog.items'], onload() { activated.push('board'); }, commands: [{ id: 'board.show', description: 'Show', usage: 'board.show', run: () => 'board' }] }, events);
    registry.register({ manifest: manifest('notes'), onload() { activated.push('notes'); }, commands: [{ id: 'notes.count', description: 'Count', usage: 'notes.count', run: () => 1 }] }, events);
    const warnings: string[] = [];
    await registry.configure({ catalog: { limit: 0 } }, async () => [], message => warnings.push(message));
    expect([...registry.unavailable.keys()]).toEqual(['catalog', 'board']);
    expect(warnings).toEqual([
      expect.stringContaining('Plugin catalog is unavailable in this invocation: plugins.settings.catalog is invalid: plugins.settings.catalog.limit: must be at least 1'),
      expect.stringContaining('Plugin board is unavailable in this invocation: Requires service catalog.items; its provider catalog is unavailable. Its commands and generators fail with PLUGIN_UNAVAILABLE'),
    ]);
    await registry.activate(events, context);
    expect(activated).toEqual(['notes']);
    expect(await registry.commands.get('notes.count')!.run([], {}, context)).toBe(1);
    for (const [id, plugin] of [['catalog.list', 'catalog'], ['board.show', 'board']] as const) {
      await expect(registry.commands.get(id)!.run([], {}, context)).rejects.toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { command: id, plugin, reason: registry.unavailable.get(plugin)!.reason, issues: ['plugins.settings.catalog.limit: must be at least 1'] } });
    }
    await registry.dispose(events);
  });

  it('keep plugins that only optionally use their services available, without those services', async () => {
    const { registry, events } = setup();
    let available: boolean | undefined;
    registry.register({ manifest: manifest('catalog'), settings: limit, provides: { 'catalog.items': { list: () => [] } } }, events);
    registry.register({ manifest: manifest('board'), optional: ['catalog.items'], onload(pluginContext) { available = pluginContext.services.has('catalog.items'); } }, events);
    await registry.configure({ catalog: { limit: 0 } }, async () => [], () => undefined);
    expect([...registry.unavailable.keys()]).toEqual(['catalog']);
    await registry.activate(events, context);
    expect(available).toBe(false);
    const board = registry.pluginContext(registry.plugins[1]!, context, events);
    expect(() => board.services.get('catalog.items')).toThrow(expect.objectContaining({ code: 'PLUGIN_SERVICE_MISSING', details: { plugin: 'board', service: 'catalog.items' } }));
    await registry.dispose(events);
  });

  it('warns about sections that name no registered, disabled or installed plugin and keeps them unchanged', async () => {
    const { registry, events } = setup(), warnings: string[] = [];
    registry.register({ manifest: manifest('search'), settings: limit }, events);
    const effective = await registry.configure({ serach: { limit: 3 }, installed: { x: 1 }, search: { limit: 2 } }, async () => ['installed'], message => warnings.push(message));
    expect(effective).toEqual({ installed: { x: 1 }, search: { limit: 2, tags: ['a'] }, serach: { limit: 3 } });
    expect(warnings).toEqual(['plugins.settings names no installed plugin: serach; the sections are kept unchanged. Check for misspelled plugin ids with plugins.']);
  });

  it('rejects settings schemas whose defaults violate them at registration', () => {
    const { registry, events } = setup();
    const settings: JsonSchema = { type: 'object', properties: { limit: { type: 'integer', minimum: 1, default: 0 }, mode: { type: 'string', enum: ['a'], default: 'b' } } };
    expect(() => registry.register({ manifest: manifest('quality'), settings }, events)).toThrow(expect.objectContaining({
      code: 'INVALID_PLUGIN', message: expect.stringContaining('settings.properties.limit.default: must be at least 1; settings.properties.mode.default: must be one of "a"'),
    }));
    expect(registry.plugins).toEqual([]);
  });

  it('hands every plugin a frozen deep copy of its settings', async () => {
    const { registry, events } = setup();
    let received: Record<string, unknown> = {};
    registry.register({ manifest: manifest('quality'), settings: limit, onload(pluginContext) { received = pluginContext.settings as Record<string, unknown>; } }, events);
    await registry.configure({ quality: { tags: ['x'] } }, async () => [], () => undefined);
    await registry.activate(events, context);
    expect(received).toEqual({ limit: 5, tags: ['x'] });
    expect(Object.isFrozen(received) && Object.isFrozen(received.tags)).toBe(true);
    expect(() => { (received.tags as string[]).push('y'); }).toThrow(TypeError);
    expect(registry.settings.canonical('quality')).toBe('{"limit":5,"tags":["x"]}');
    await registry.dispose(events);
  });
});

describe('services handed to consumers', () => {
  it('are read-only views whose methods still run against the provider', async () => {
    const { registry, events } = setup();
    let consumer: { count(): number; add(): void; label: string } | undefined;
    const counter = { label: 'counter', total: 0, add() { this.total++; }, count() { return this.total; } };
    registry.register({ manifest: manifest('counter'), provides: { 'counter.api': counter } }, events);
    registry.register({ manifest: manifest('user'), requires: ['counter.api'], onload(pluginContext) { consumer = pluginContext.services.get('counter.api'); } }, events);
    await registry.activate(events, context);
    consumer!.add();
    expect(consumer!.count()).toBe(1);
    expect(counter.total).toBe(1);
    expect(consumer!.add).toBe(consumer!.add);
    expect(() => { consumer!.label = 'stolen'; }).toThrow(TypeError);
    expect(() => { delete (consumer as Partial<typeof counter>).label; }).toThrow(TypeError);
    expect(() => Object.defineProperty(consumer, 'count', { value: () => 99 })).toThrow(TypeError);
    expect(counter.label).toBe('counter');
    const frozen = Object.freeze({ ids: () => ['a'] });
    const { registry: other, events: otherEvents } = setup();
    other.register({ manifest: manifest('frozen'), provides: { 'frozen.api': frozen } }, otherEvents);
    other.register({ manifest: manifest('reader'), requires: ['frozen.api'], onload(pluginContext) { expect(pluginContext.services.get<typeof frozen>('frozen.api').ids()).toEqual(['a']); } }, otherEvents);
    await other.activate(otherEvents, context);
    await registry.dispose(events);
    await other.dispose(otherEvents);
  });
});
