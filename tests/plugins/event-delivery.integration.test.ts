import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/the-forge/application/plugins/events.ts';
import { NodeEventScope } from '../../src/the-forge/infrastructure/plugins/event-scope.ts';

const create = () => {
  const bus = new EventBus(new NodeEventScope());
  bus.define({ id: 'task.changed', validate: (value): value is number => typeof value === 'number' });
  return bus;
};

describe('asynchronous event delivery ancestry', () => {
  it('delivers independent concurrent events without treating them as recursive', async () => {
    const bus = create();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const received: number[] = [];
    bus.on<number>('task.changed', async value => { await pending; received.push(value); });
    const deliveries = Array.from({ length: 33 }, (_, index) => bus.emit('task.changed', index));
    release();
    await Promise.all(deliveries);
    expect(received).toEqual(Array.from({ length: 33 }, (_, index) => index));
    expect(bus.history).toHaveLength(33);
    expect(bus.warnings).toEqual([]);
  });

  it('counts parallel children as siblings within a listener rather than deeper recursion', async () => {
    const bus = create();
    bus.on<number>('task.changed', async value => {
      if (value === 0) await Promise.all(Array.from({ length: 40 }, (_, index) => bus.emit('task.changed', index + 1)));
      else await Promise.resolve();
    });
    await bus.emit('task.changed', 0);
    expect(bus.history).toHaveLength(41);
    expect(bus.warnings).toEqual([]);
  });

  it('still stops genuine recursive notifications after an asynchronous boundary', async () => {
    const bus = create();
    bus.on<number>('task.changed', async value => {
      await Promise.resolve();
      await bus.emit('task.changed', value + 1);
    });
    await bus.emit('task.changed', 0);
    expect(bus.history).toHaveLength(32);
    expect(bus.warnings).toEqual(['Listener task.changed: Event recursion exceeds 32.']);
    await bus.emit('task.changed', 100);
    expect(bus.history).toHaveLength(64);
  });

  it('does not retain completed ancestors in notifications scheduled for a later turn', async () => {
    const bus = create();
    const scheduled: Array<() => void> = [];
    let completed!: () => void;
    const done = new Promise<void>(resolve => { completed = resolve; });
    bus.on<number>('task.changed', value => {
      if (value === 40) { completed(); return; }
      const follow = new Promise<void>(resolve => { scheduled.push(resolve); });
      void follow.then(() => bus.emit('task.changed', value + 1));
    });
    await bus.emit('task.changed', 0);
    for (let index = 0; index < 40; index++) {
      scheduled[index]!();
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    await done;
    expect(bus.history).toHaveLength(41);
    expect(bus.warnings).toEqual([]);
  });
});
