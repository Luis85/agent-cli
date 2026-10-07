import { expect, it } from 'vitest';
import { EventBus } from '../src/application/events.ts';
import { Registry, type CommandContext, type Plugin } from '../src/application/plugins.ts';
const plugin = (id: string): Plugin => ({ manifest: { id, version: '1.0.0', apiVersion: 1 } });
it('rejects namespace theft, duplicate plugins and reserved global options', () => {
  const registry = new Registry(), events = new EventBus();
  registry.register(plugin('one'), events);
  expect(() => registry.register(plugin('one'), events)).toThrow();
  expect(() => registry.register({ ...plugin('two'), skills: [{ id: 'one.skill', content: 'bad' }] }, events)).toThrow();
  expect(() => registry.register({ ...plugin('two'), commands: [{ id: 'two.run', description: 'Run', usage: 'two.run', options: { root: 'string' }, run() {} }] }, events)).toThrow();
});
it('disposes successful activations in reverse order after a later activation fails', async () => {
  const registry = new Registry(), events = new EventBus(), calls: string[] = [];
  registry.register({ ...plugin('one'), activate() { calls.push('one'); return async () => { await Promise.resolve(); calls.push('dispose-one'); }; } }, events);
  registry.register({ ...plugin('two'), activate() { calls.push('two'); return () => { calls.push('dispose-two'); throw new Error('cleanup failed'); }; } }, events);
  registry.register({ ...plugin('three'), activate() { throw new Error('activation failed'); } }, events);
  await expect(registry.activate({ events } as CommandContext)).rejects.toThrow('activation failed');
  await registry.dispose(events);
  expect(calls).toEqual(['one', 'two', 'dispose-two', 'dispose-one']);
  expect(events.warnings[0]).toContain('cleanup failed');
  await registry.dispose(events);
  expect(calls).toHaveLength(4);
});
