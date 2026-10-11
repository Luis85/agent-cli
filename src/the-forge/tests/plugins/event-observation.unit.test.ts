import { describe, expect, it } from 'vitest';
import { EventBus, type EventRecord } from '../../src/application/plugins/events.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';

const create = () => {
  const bus = new EventBus(new NodeEventScope());
  bus.define({ id: 'task.changed', description: 'A task changed.', validate: (value): value is { count: number } => Boolean(value && typeof value === 'object' && 'count' in value && typeof value.count === 'number') });
  return bus;
};

describe('all-event observation and retained-history replay', () => {
  it('delivers named and all-event listeners in subscription order with independent snapshots', async () => {
    const bus = create(), calls: string[] = [];
    bus.onAny(record => { calls.push(`any:${record.id}`); (record.payload as { count: number }).count = 999; });
    bus.on<{ count: number }>('task.changed', value => { calls.push(`named:${value.count}`); });
    const off = bus.onAny(async record => { await Promise.resolve(); calls.push(`last:${(record.payload as { count: number }).count}`); });
    await bus.emit('task.changed', { count: 1 });
    expect(calls).toEqual(['any:task.changed', 'named:1', 'last:1']);
    expect(bus.history).toEqual([{ id: 'task.changed', payload: { count: 1 } }]);
    off(); calls.length = 0;
    await bus.emit('task.changed', { count: 2 });
    expect(calls).toEqual(['any:task.changed', 'named:2']);
  });

  it('does not replay automatically and awaits explicit replay without re-emitting history', async () => {
    const bus = create();
    await bus.emit('task.changed', { count: 1 });
    const live: EventRecord[] = [], replayed: EventRecord[] = [];
    bus.onAny(record => { live.push(record); });
    expect(live).toEqual([]);
    await bus.replay(async record => {
      await Promise.resolve();
      replayed.push(record);
      (record.payload as { count: number }).count = 99;
    });
    expect(replayed).toHaveLength(1);
    expect(live).toEqual([]);
    expect(bus.history).toEqual([{ id: 'task.changed', payload: { count: 1 } }]);
  });

  it('lets replay callbacks emit live events without deadlock or recursively replaying new records', async () => {
    const bus = create();
    await bus.emit('task.changed', { count: 1 });
    const live: EventRecord[] = [], replayed: EventRecord[] = [];
    bus.onAny(record => { live.push(record); });
    await bus.replay(async record => {
      replayed.push(record);
      await bus.emit('task.changed', { count: 2 });
    });
    expect(replayed).toEqual([{ id: 'task.changed', payload: { count: 1 } }]);
    expect(live).toEqual([{ id: 'task.changed', payload: { count: 2 } }]);
    expect(bus.history).toHaveLength(2);
  });

  it('isolates failures including unprintable thrown objects and respects immediate unsubscription', async () => {
    const bus = create(), received: string[] = [];
    bus.onAny(() => { throw Object.create(null); });
    bus.onAny(() => { off(); received.push('kept'); });
    const off = bus.onAny(() => { received.push('removed'); });
    await expect(bus.emit('task.changed', { count: 1 })).resolves.toBeUndefined();
    expect(received).toEqual(['kept']);
    await bus.replay(() => { throw Object.create(null); });
    expect(bus.warnings).toHaveLength(2);
  });

  it('excludes subscriptions added during the current delivery and observes later definitions', async () => {
    const bus = create(), seen: string[] = [];
    bus.on('task.changed', () => { bus.onAny(record => { seen.push(record.id); }); });
    await bus.emit('task.changed', { count: 1 });
    expect(seen).toEqual([]);
    bus.define({ id: 'later.event', validate: (_value): _value is unknown => true });
    await bus.emit('later.event', null);
    expect(seen).toEqual(['later.event']);
  });

  it('warns once about bounded history while delivering every event and replaying retained records', async () => {
    const bus = create(); let delivered = 0, replayed = 0;
    bus.onAny(() => { delivered++; });
    for (let count = 0; count < 1002; count++) await bus.emit('task.changed', { count });
    await bus.replay(() => { replayed++; });
    expect(delivered).toBe(1002);
    expect(replayed).toBe(1000);
    expect(bus.history).toHaveLength(1000);
    expect(bus.warnings).toEqual([expect.stringContaining('Event history reached 1000 records')]);
  });

  it('exposes isolated catalog descriptions and monotonic operation ids', () => {
    const bus = create(), catalog = bus.catalog();
    expect(catalog).toEqual([{ id: 'task.changed', description: 'A task changed.' }]);
    catalog[0]!.description = 'changed';
    expect(bus.catalog()[0]!.description).toBe('A task changed.');
    expect([bus.nextOperationId(), bus.nextOperationId()]).toEqual([1, 2]);
    expect(create().nextOperationId()).toBe(1);
    expect(() => bus.define({ id: 'bad.event', description: '', validate: (_value): _value is unknown => true })).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
  });

  it('rejects malformed callbacks and prevents subscriptions or replay after disposal', async () => {
    const bus = create();
    expect(() => bus.onAny(null as never)).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT_LISTENER' }));
    await expect(bus.replay(null as never)).rejects.toMatchObject({ code: 'INVALID_EVENT_LISTENER' });
    bus.dispose();
    expect(() => bus.onAny(() => {})).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
    await expect(bus.replay(() => {})).rejects.toMatchObject({ code: 'INVALID_EVENT' });
  });
});
