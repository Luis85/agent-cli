import { NodeEventScope } from '../../src/the-forge/infrastructure/plugins/event-scope.ts';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/the-forge/application/plugins/events.ts';
const create = () => {
  const bus = new EventBus(new NodeEventScope()); bus.define({ id: 'task.changed', validate: (v): v is { id: string } => !!v && typeof v === 'object' && 'id' in v && typeof v.id === 'string' }); return bus;
};
describe('invocation event bus', () => {
  it('awaits ordered listeners, isolates mutations and catches synchronous/asynchronous failures', async () => {
    const bus = create(), calls: string[] = [];
    bus.on<{ id: string }>('task.changed', p => { p.id = 'mutated'; calls.push('first'); throw new Error('sync'); });
    bus.on('task.changed', async () => { await Promise.resolve(); calls.push('second'); throw new Error('async'); });
    bus.on<{ id: string }>('task.changed', p => { calls.push(p.id); });
    await bus.emit('task.changed', { id: 'original' });
    expect(calls).toEqual(['first', 'second', 'original']); expect(bus.warnings).toHaveLength(2);
    expect(bus.history[0]?.payload).toEqual({ id: 'original' });
  });
  it('once unsubscribes before reentrancy and respects removal during delivery', async () => {
    const bus = create(); let count = 0, skipped = 0;
    bus.once('task.changed', async () => { count++; await bus.emit('task.changed', { id: 'nested' }); });
    bus.on('task.changed', () => off());
    const off = bus.on('task.changed', () => { skipped++; });
    await bus.emit('task.changed', { id: 'outer' });
    expect(count).toBe(1); expect(skipped).toBe(0);
  });
  it('rejects invalid definitions/payloads and use after disposal', async () => {
    const bus = create();
    expect(() => bus.define({ id: 'task.changed', validate: (_v): _v is unknown => true })).toThrow();
    await expect(bus.emit('task.changed', { id: 1 })).rejects.toThrow();
    await expect(bus.emit('unknown.event', {})).rejects.toThrow();
    bus.dispose(); bus.dispose();
    expect(() => bus.on('task.changed', () => {})).toThrow();
    await expect(bus.emit('task.changed', { id: 'a' })).rejects.toThrow();
  });
  it('bounds recursive notifications', async () => {
    const bus = create(); bus.on('task.changed', () => bus.emit('task.changed', { id: 'again' }));
    await bus.emit('task.changed', { id: 'first' });
    expect(bus.history).toHaveLength(32); expect(bus.warnings).toHaveLength(1);
  });
});
it('rejects non-JSON payloads before recording or notifying', async () => {
  const bus = new EventBus(new NodeEventScope()); let delivered = 0;
  bus.define({ id: 'anything.changed', validate: (_v): _v is unknown => true });
  bus.on('anything.changed', () => { delivered++; });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const payload of [undefined, { missing: undefined }, 1n, NaN, Infinity, new Map(), new Date(), cycle, [undefined], Array(1), () => {}]) {
    await expect(bus.emit('anything.changed', payload)).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_EVENT_PAYLOAD' }));
  }
  expect(bus.history).toEqual([]); expect(delivered).toBe(0);
  await bus.emit('anything.changed', { nested: [null, true, 1, 'ok'] });
  expect(JSON.parse(JSON.stringify(bus.history))[0].payload).toEqual({ nested: [null, true, 1, 'ok'] });
});
it('isolates validator mutation and rejects asynchronous or throwing guards', async () => {
  const bus = new EventBus(new NodeEventScope());
  bus.define({ id: 'task.changed', validate: (value): value is unknown => { (value as { id: string }).id = 'mutated'; return true; } });
  await bus.emit('task.changed', { id: 'original' });
  expect(bus.history[0]?.payload).toEqual({ id: 'original' });
  for (const validate of [() => { throw new Error('guard failed'); }, async () => { throw new Error('async guard failed'); }]) {
    const other = new EventBus(new NodeEventScope());
    other.define({ id: 'task.changed', validate: validate as unknown as (value: unknown) => value is unknown });
    await expect(other.emit('task.changed', {})).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_EVENT_PAYLOAD' }));
    expect(other.history).toEqual([]);
  }
});
it('rejects invalid listener and event definition shapes immediately', () => {
  const bus = create();
  expect(() => bus.define(null as never)).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
  expect(() => bus.on('task.changed', null as never)).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT_LISTENER' }));
  expect(() => bus.once('task.changed', null as never)).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT_LISTENER' }));
});
