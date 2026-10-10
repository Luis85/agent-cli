import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/domain/shared/errors.ts';
import { EventBus, type EventRecord } from '../../src/application/plugins/events.ts';
import { Registry, type CommandContext, type Plugin } from '../../src/application/plugins/registry.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { skillFrontmatter } from '../../src/infrastructure/plugins/skill-frontmatter.ts';

const plugin = (id: string): Plugin => ({ manifest: { id, name: id, version: '1.0.0', minAppVersion: '0.1.0', description: 'Lifecycle test', author: 'Test' } });
const create = () => {
  const registry = new Registry(skillFrontmatter), events = new EventBus(new NodeEventScope());
  registerHostEvents(events);
  return { registry, events, context: {} as CommandContext };
};

describe('observable plugin lifecycle', () => {
  it('publishes registration once, supports startup replay and includes no-op cleanup lifecycles', async () => {
    const { registry, events, context } = create();
    const replayed: EventRecord[] = [], live: EventRecord[] = [];
    registry.register({ ...plugin('observer'), async onload({ events }) {
      events.onAny(record => { live.push(record); });
      await events.replay(record => { replayed.push(record); });
    } }, events);
    registry.register(plugin('plain'), events);
    await registry.publishRegistered(events);
    await registry.publishRegistered(events);
    await registry.activate(events, context);
    await registry.dispose(events);
    expect(replayed.map(record => record.id)).toEqual(['plugin.registered', 'plugin.registered', 'plugin.activating']);
    expect(events.history.filter(record => record.id === 'plugin.registered')).toHaveLength(2);
    expect(live.map(record => `${record.id}:${(record.payload as { pluginId: string }).pluginId}`)).toEqual([
      'plugin.activated:observer', 'plugin.activating:plain', 'plugin.activated:plain',
      'plugin.unloading:plain', 'plugin.unloaded:plain', 'plugin.unloading:observer', 'plugin.unloaded:observer',
    ]);
  });

  it('retains activation failure and reports failed cleanup without replacing the primary error', async () => {
    const { registry, events, context } = create();
    const primary = new AppError('ACTIVATION_BROKEN', 'private diagnostic', 4);
    events.onAny(() => { throw Object.create(null); });
    registry.register({ ...plugin('broken'), onload() { throw primary; }, onunload() { throw Object.create(null); } }, events);
    await expect(registry.activate(events, context)).rejects.toBe(primary);
    await expect(registry.dispose(events)).resolves.toBeUndefined();
    expect(events.history).toContainEqual({ id: 'plugin.activation-failed', payload: { pluginId: 'broken', error: { code: 'ACTIVATION_BROKEN', exitCode: 4 } } });
    expect(events.history.map(record => record.id)).toEqual(['plugin.registered', 'plugin.activating', 'plugin.activation-failed', 'plugin.unloading', 'plugin.unload-failed']);
    expect(JSON.stringify(events.history)).not.toContain('private diagnostic');
    expect(events.warnings.length).toBeGreaterThan(0);
  });

  it('does not report registered capabilities when atomic plugin validation failed', async () => {
    const { registry, events } = create();
    expect(() => registry.register({ ...plugin('bad'), events: [{ id: 'vault.create', validate: (_value): _value is unknown => true }] }, events)).toThrow();
    await registry.publishRegistered(events);
    expect(events.history).toEqual([]);
  });

  it('continues cleanup and preserves the activation error when cleanup diagnostics cannot be written', async () => {
    const { registry, events, context } = create();
    const primary = new AppError('ACTIVATION_BROKEN', 'Original activation failure', 4);
    const cleaned: string[] = [];
    events.warn = () => { throw new Error('Diagnostic sink unavailable'); };
    registry.register({ ...plugin('first'), onunload() { cleaned.push('first'); } }, events);
    registry.register({ ...plugin('broken'), onload() { throw primary; }, onunload() {
      cleaned.push('broken');
      throw Object.create(null);
    } }, events);
    const invocation = async () => {
      try { await registry.activate(events, context); }
      finally { await registry.dispose(events); }
    };
    await expect(invocation()).rejects.toBe(primary);
    expect(cleaned).toEqual(['broken', 'first']);
    expect(events.history.slice(-4).map(record => record.id)).toEqual(['plugin.unloading', 'plugin.unload-failed', 'plugin.unloading', 'plugin.unloaded']);
    expect(events.history.at(-1)?.payload).toEqual({ pluginId: 'first' });
  });
});
