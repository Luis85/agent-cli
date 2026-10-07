import { NodeEventScope } from '../../src/the-forge/infrastructure/plugins/event-scope.ts';
import { globalOptions } from '../../src/the-forge/presentation/cli/arguments.ts';
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnabledPlugins } from '../../src/the-forge/infrastructure/plugins/loader.ts';
import { NodeFiles } from '../../src/the-forge/infrastructure/workspace/files.ts';
import { EventBus } from '../../src/the-forge/application/plugins/events.ts';
import { Registry, type CommandContext, type Plugin } from '../../src/the-forge/application/plugins/registry.ts';
const plugin = (id: string): Plugin => ({ manifest: { id, name: id, version: '1.0.0', minAppVersion: '0.1.0', description: 'Test plugin', author: 'Test' } });
it('rejects namespace theft, duplicate plugins and reserved global options', () => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  registry.register(plugin('one'), events);
  expect(() => registry.register(plugin('one'), events)).toThrow();
  expect(() => registry.register({ ...plugin('two'), skills: [{ id: 'one.skill', content: 'bad' }] }, events)).toThrow();
  expect(() => registry.register({ ...plugin('two'), commands: [{ id: 'two.run', description: 'Run', usage: 'two.run', options: { root: 'string' }, run() {} }] }, events)).toThrow();
});
it('disposes successful activations in reverse order after a later activation fails', async () => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope()), calls: string[] = [];
  registry.register({ ...plugin('one'), onload() { calls.push('one'); }, async onunload() { await Promise.resolve(); calls.push('dispose-one'); } }, events);
  registry.register({ ...plugin('two'), onload() { calls.push('two'); }, onunload() { calls.push('dispose-two'); throw new Error('cleanup failed'); } }, events);
  registry.register({ ...plugin('three'), onload() { throw new Error('activation failed'); } }, events);
  await expect(registry.activate({ events } as CommandContext)).rejects.toThrow('activation failed');
  await registry.dispose(events);
  expect(calls).toEqual(['one', 'two', 'dispose-two', 'dispose-one']);
  expect(events.warnings[0]).toContain('cleanup failed');
  await registry.dispose(events);
  expect(calls).toHaveLength(4);
});
it('publishes no contributions when any registration fails', () => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  const candidate: Plugin = { ...plugin('atomic'),
    commands: [{ id: 'atomic.run', description: 'Run', usage: 'atomic.run', run() {} }],
    events: [{ id: 'atomic.changed', validate: (_v): _v is unknown => true }],
    skills: [{ id: 'atomic.skill', content: 42 as unknown as string }],
  };
  expect(() => registry.register(candidate, events)).toThrow();
  expect(registry.commands.size).toBe(0); expect(events.ids()).toEqual([]); expect(registry.plugins).toEqual([]);
  candidate.skills = [];
  candidate.events!.push(candidate.events![0]!);
  expect(() => registry.register(candidate, events)).toThrow();
  expect(registry.commands.size).toBe(0); expect(events.ids()).toEqual([]);
  candidate.events!.pop();
  registry.register(candidate, events);
  expect(registry.commands.has('atomic.run')).toBe(true); expect(events.ids()).toEqual(['atomic.changed']);
});
it.each([
  null, { manifest: null }, { ...plugin('bad'), commands: {} },
  { ...plugin('bad'), commands: [null] }, { ...plugin('bad'), events: [{ id: 3 }] },
  { ...plugin('bad'), onload: 'yes' },
  { ...plugin('bad'), commands: [{ id: 'bad.run', description: '', usage: '', run() {}, options: [] }] },
  { ...plugin('bad'), generators: [{ id: 'bad.generator', generate() { return []; } }] },
])('reports invalid JavaScript plugin shapes with a structured error (%j)', candidate => {
  expect(() => new Registry().register(candidate as Plugin, new EventBus(new NodeEventScope()))).toThrowError(expect.objectContaining({ code: 'INVALID_PLUGIN' }));
});
it('rejects repeated activation and registration after activation/disposal', async () => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope()); let activations = 0;
  registry.register({ ...plugin('one'), onload() { activations++; } }, events);
  await registry.activate({ events } as CommandContext);
  await expect(registry.activate({ events } as CommandContext)).rejects.toThrowError(expect.objectContaining({ code: 'PLUGIN_LIFECYCLE' }));
  expect(() => registry.register(plugin('two'), events)).toThrow();
  await registry.dispose(events);
  await expect(registry.activate({ events } as CommandContext)).rejects.toThrow();
  expect(activations).toBe(1);
});

it('unloads a partially loaded plugin before earlier plugins', async () => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope()), calls: string[] = [];
  registry.register({ ...plugin('first'), onunload() { calls.push('first'); } }, events);
  registry.register({ ...plugin('broken'), onload() { throw new Error('partial load'); }, onunload() { calls.push('broken'); } }, events);
  await expect(registry.activate({ events } as CommandContext)).rejects.toThrow('partial load');
  await registry.dispose(events);
  expect(calls).toEqual(['broken', 'first']);
});

it('retains the original unload hook and its receiver when activation replaces the hook', async () => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  const calls: string[] = [];
  const candidate: Plugin = {
    ...plugin('mutable'),
    onload() { this.onunload = () => { calls.push('replacement'); }; },
    onunload() { calls.push(this.manifest.id); },
  };
  registry.register(candidate, events);
  await registry.activate({ events } as CommandContext);
  await registry.dispose(events);
  expect(calls).toEqual(['mutable']);
  expect(events.warnings).toEqual([]);
});

const temporaryRoots: string[] = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agent-plugin-')); temporaryRoots.push(root);
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  return { root, files: await NodeFiles.at(root), registry: new Registry(), events: new EventBus(new NodeEventScope()) };
}
async function packagePlugin(root: string, id: string, source: string, entry = 'main.mjs', overrides: Record<string, unknown> = {}) {
  const directory = join(root, 'plugins', id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...plugin(id).manifest, ...overrides }));
  await writeFile(join(directory, entry), source);
}
it('loads only enabled directory packages and preserves class lifecycle receivers', async () => {
  const { root, files, registry, events } = await fixture();
  await packagePlugin(root, 'quality', `export default class {
    constructor(manifest) { this.id = manifest.id; this.commands = [{id: manifest.id+'.run', description:'Run',usage:'quality.run',run(){return {ok:true}}}]; }
    onload(context) { this.events = context.events; context.events.warn(this.id + ':loaded'); }
    onunload() { this.events.warn(this.id + ':unloaded'); }
  }`);
  await packagePlugin(root, 'disabled', `throw new Error('disabled code executed');`);
  await loadEnabledPlugins('plugins', ['quality'], files, registry, events);
  expect(registry.commands.has('quality.run')).toBe(true);
  await registry.activate({ events } as CommandContext);
  await registry.dispose(events);
  expect(events.warnings).toEqual(['quality:loaded', 'quality:unloaded']);
});
it('loads Obsidian-style CommonJS main.js inside a type:module project', async () => {
  const { root, files, registry, events } = await fixture();
  await packagePlugin(root, 'common', `const path = require('node:path'); module.exports = {
    commands: [{ id: 'common.run', description: 'Run', usage: 'common.run', run() { return { directory: path.basename(__dirname), filename: path.basename(__filename) }; } }]
  };`, 'main.js');
  await loadEnabledPlugins('plugins', ['common'], files, registry, events);
  expect(await registry.commands.get('common.run')!.run([], {}, { events } as CommandContext)).toEqual({ directory: 'common', filename: 'main.js' });
});
it('validates every manifest before executing enabled plugin code', async () => {
  const { root, files, registry, events } = await fixture();
  await packagePlugin(root, 'first', `throw new Error('must not execute yet');`);
  await packagePlugin(root, 'future', `export default {};`, 'main.mjs', { minAppVersion: '99.0.0' });
  await expect(loadEnabledPlugins('plugins', ['first', 'future'], files, registry, events)).rejects.toThrowError(expect.objectContaining({ code: 'INCOMPATIBLE_PLUGIN' }));
  expect(registry.plugins).toEqual([]);
});
it('rejects duplicate/traversal enabled IDs and manifest identity mismatch', async () => {
  const { root, files, registry, events } = await fixture();
  for (const ids of [['same', 'same'], ['../outside']]) await expect(loadEnabledPlugins('plugins', ids, files, registry, events)).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_PLUGIN_CONFIG' }));
  await packagePlugin(root, 'quality', 'export default {};', 'main.mjs', { id: 'different' });
  await expect(loadEnabledPlugins('plugins', ['quality'], files, registry, events)).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_PLUGIN' }));
});
it('does not fall back to CommonJS when an ESM entry fails during evaluation', async () => {
  const { root, files, registry, events } = await fixture();
  await packagePlugin(root, 'broken', `throw new Error('ESM broken');`);
  await writeFile(join(root, 'plugins/broken/main.js'), 'module.exports = {};');
  await expect(loadEnabledPlugins('plugins', ['broken'], files, registry, events)).rejects.toThrow('ESM broken');
});
it.each(Object.keys(globalOptions))('reserves the global --%s option for the host', option => {
  const registry = new Registry(), events = new EventBus(new NodeEventScope());
  expect(() => registry.register({ ...plugin('quality'), commands: [{ id: 'quality.run', description: 'Run', usage: 'quality.run', options: { [option]: 'boolean' }, run() {} }] }, events)).toThrowError(expect.objectContaining({ code: 'INVALID_PLUGIN' }));
});
