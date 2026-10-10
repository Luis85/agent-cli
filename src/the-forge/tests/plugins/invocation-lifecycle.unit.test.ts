import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { announceLayoutReady, quitInvocation } from '../../src/application/plugins/invocation.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';

const create = () => {
  const bus = new EventBus(new NodeEventScope());
  registerHostEvents(bus);
  return bus;
};

describe('layout ready and quit', () => {
  it('queues onLayoutReady callbacks until plugins are active, runs them in order, then publishes workspace.layout-ready', async () => {
    const bus = create(), order: string[] = [];
    bus.on('workspace.layout-ready', payload => { order.push(`event:${JSON.stringify(payload)}`); });
    bus.onLayoutReady(async () => { await Promise.resolve(); order.push('first'); });
    bus.onLayoutReady(() => { order.push('second'); throw new Error('second failed'); });
    bus.onLayoutReady(() => { order.push('third'); });
    expect(order).toEqual([]);
    await announceLayoutReady(bus);
    expect(order).toEqual(['first', 'second', 'third', 'event:{}']);
    expect(bus.warnings).toEqual(['Layout ready: second failed']);
    await announceLayoutReady(bus);
    expect(bus.history.filter(record => record.id === 'workspace.layout-ready')).toHaveLength(2);
    expect(order.filter(entry => entry === 'first')).toHaveLength(1);
  });

  it('runs onLayoutReady immediately once the layout is ready, and quit settles it first', async () => {
    const bus = create(), order: string[] = [];
    await announceLayoutReady(bus);
    let release!: () => void;
    bus.onLayoutReady(async () => { order.push('immediate'); await new Promise<void>(resolve => { release = resolve; }); order.push('settled'); });
    expect(order).toEqual(['immediate']);
    bus.onQuit(() => { order.push('quit task'); });
    const quitting = quitInvocation(bus);
    await Promise.resolve();
    release();
    await quitting;
    expect(order).toEqual(['immediate', 'settled', 'quit task']);
  });

  it('publishes workspace.quit with an empty payload, then runs quit tasks in order, including tasks added by listeners', async () => {
    const bus = create(), order: string[] = [];
    bus.onQuit(async () => { await Promise.resolve(); order.push('task 1'); bus.onQuit(() => { order.push('task 3'); }); });
    bus.on('workspace.quit', () => { order.push('listener'); bus.onQuit(() => { order.push('task 2'); throw new Error('cleanup failed'); }); });
    await quitInvocation(bus);
    expect(order).toEqual(['listener', 'task 1', 'task 2', 'task 3']);
    expect(bus.history).toEqual([{ id: 'workspace.quit', payload: {} }]);
    expect(bus.warnings).toEqual(['Quit task: cleanup failed']);
  });

  it('keeps quit best effort when the diagnostic sink fails and rejects invalid callbacks', async () => {
    const bus = create();
    bus.warn = () => { throw new Error('Diagnostic sink unavailable'); };
    bus.onQuit(() => { throw new Error('task failed'); });
    await expect(quitInvocation(bus)).resolves.toBeUndefined();
    expect(() => bus.onQuit('not a function' as never)).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT_LISTENER' }));
    expect(() => bus.onLayoutReady(null as never)).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT_LISTENER' }));
    bus.dispose();
    expect(() => bus.onQuit(() => {})).toThrowError(expect.objectContaining({ code: 'INVALID_EVENT' }));
  });
});
