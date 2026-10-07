import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/application/events.ts';
const create = () => {
  const bus = new EventBus(); bus.define({ id: 'task.changed', validate: (v): v is { id: string } => !!v && typeof v === 'object' && 'id' in v && typeof v.id === 'string' }); return bus;
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
