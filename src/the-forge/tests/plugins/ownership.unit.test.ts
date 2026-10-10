import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents, hostEventNamespaces } from '../../src/application/plugins/host-events.ts';
import { pluginEvents } from '../../src/application/plugins/ownership.ts';
import { Registry, validatePluginManifest, type CommandContext, type Plugin } from '../../src/application/plugins/registry.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { errorCatalog } from '../../src/domain/shared/error-catalog.ts';
import { germanErrors } from '../../src/presentation/localization/errors.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';

const manifest = (id: string) => ({ id, name: id, version: '1.0.0', minAppVersion: '0.1.0', description: 'Ownership test', author: 'Test' });
const plugin = (id: string, extra: Partial<Plugin> = {}): Plugin => ({ manifest: manifest(id), ...extra });
const valid = (_value: unknown): _value is unknown => true;
const create = () => {
  const bus = new EventBus(new NodeEventScope());
  registerHostEvents(bus);
  return bus;
};

describe('event ownership', () => {
  it('lets a plugin emit its own events but rejects host and foreign events with EVENT_OWNERSHIP', async () => {
    const bus = create();
    bus.defineAll([{ id: 'quality.checked', validate: valid }, { id: 'other.done', validate: valid }]);
    const events = pluginEvents(bus, 'quality');
    await events.emit('quality.checked', { ok: true });
    for (const id of ['vault.create', 'metadataCache.resolved', 'workspace.quit', 'operation.started', 'command.started', 'plugin.activated']) {
      await expect(events.emit(id, {})).rejects.toMatchObject({ code: 'EVENT_OWNERSHIP', exitCode: 2, message: expect.stringContaining('belongs to the host') });
    }
    await expect(events.emit('other.done', {})).rejects.toMatchObject({ code: 'EVENT_OWNERSHIP', message: expect.stringContaining('belongs to plugin other') });
    await expect(events.emit('quality.unknown', {})).rejects.toMatchObject({ code: 'UNKNOWN_EVENT' });
    expect(bus.history).toEqual([{ id: 'quality.checked', payload: { ok: true } }]);
  });

  it('still observes host events and shares warnings, replay and lifecycle callbacks with the bus', async () => {
    const bus = create(), events = pluginEvents(bus, 'quality'), seen: string[] = [];
    events.on('vault.create', () => { seen.push('vault.create'); });
    events.onAny(record => { seen.push(`any:${record.id}`); });
    await bus.emit('vault.create', { path: 'a.md', kind: 'file', operation: 'created', revision: 'r', bytes: 1 });
    await events.replay(record => { seen.push(`replay:${record.id}`); });
    events.warn('from plugin');
    events.onLayoutReady(() => { seen.push('ready'); });
    await bus.markLayoutReady();
    expect(seen).toEqual(['vault.create', 'any:vault.create', 'replay:vault.create', 'ready']);
    expect(bus.warnings).toEqual(['from plugin']);
    expect(events.ids()).toEqual(bus.ids());
    expect(events.catalog()).toEqual(bus.catalog());
  });

  it('gives plugin commands and lifecycle hooks the owned channel, while host contexts keep the bus', async () => {
    const bus = create(), registry = new Registry(skillFrontmatter), outcomes: string[] = [];
    const attempt = async (events: CommandContext['events'], label: string) => {
      try { await events.emit('vault.create', { path: 'x.md', kind: 'file', operation: 'created', revision: 'r', bytes: 1 }); outcomes.push(`${label}:emitted`); }
      catch (error) { outcomes.push(`${label}:${(error as { code: string }).code}`); }
    };
    registry.register(plugin('quality', {
      async onload(context) { await attempt(context.events, 'onload'); },
      commands: [{ id: 'quality.run', description: 'Run', usage: 'quality.run', async run(_args, _flags, context) { await attempt(context.events, 'command'); return { ok: true }; } }],
    }), bus);
    const context = { events: bus } as unknown as CommandContext;
    await registry.activate(bus, context);
    expect(await registry.commands.get('quality.run')!.run([], {}, context)).toEqual({ ok: true });
    await attempt(context.events, 'host');
    expect(outcomes).toEqual(['onload:EVENT_OWNERSHIP', 'command:EVENT_OWNERSHIP', 'host:emitted']);
    expect(bus.history.filter(record => record.id === 'vault.create')).toHaveLength(1);
  });

  it('reserves every host namespace that a plugin id could spell', () => {
    for (const id of hostEventNamespaces.filter(namespace => /^[a-z][a-z0-9-]*$/.test(namespace))) {
      expect(() => validatePluginManifest(manifest(id))).toThrowError(expect.objectContaining({ code: 'PLUGIN_NAMESPACE' }));
    }
    expect(() => validatePluginManifest(manifest('vaults'))).not.toThrow();
    // The recovery hints list every reserved namespace.
    for (const hint of [errorCatalog.PLUGIN_NAMESPACE.hint, germanErrors.PLUGIN_NAMESPACE.hint]) {
      expect(hint.match(/\(([^)]*)\)/)![1]!.split(', ')).toEqual([...hostEventNamespaces]);
    }
  });

  it('accepts camelCase event segments such as metadataCache.changed but keeps lowercase leading characters', () => {
    const bus = new EventBus(new NodeEventScope());
    expect(() => bus.define({ id: 'quality.itemChanged', validate: valid })).not.toThrow();
    expect(() => bus.define({ id: 'Quality.changed', validate: valid })).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
    expect(() => bus.define({ id: 'quality.Changed', validate: valid })).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
  });
});
