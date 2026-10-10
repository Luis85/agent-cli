import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { bundledCorePlugins } from '../support/core-plugins.ts';

const fixture = portableCli();
type Record = { id: string; payload: { [key: string]: unknown } };
const ids = (events: Record[]) => events.map(event => event.id);

async function workspace(name: string, plugin?: string) {
  const root = join(fixture.project, name);
  await mkdir(join(root, 'bin/plugins/parity'), { recursive: true });
  await writeFile(join(root, 'bin/config.json'), JSON.stringify({ plugins: { enabled: plugin ? ['parity'] : [] } }));
  if (plugin) {
    await writeFile(join(root, 'bin/plugins/parity/manifest.json'), JSON.stringify({ id: 'parity', name: 'Parity', version: '1.0.0', minAppVersion: '0.1.0', description: 'Event parity fixture', author: 'Tests' }));
    await writeFile(join(root, 'bin/plugins/parity/main.mjs'), plugin);
  }
  return { root, run: (args: string[]) => fixture.cli(args, undefined, { root }) };
}

describe('Obsidian event parity through the portable CLI', () => {
  it('reports vault.* records by default, quick previews in dry runs and file-open on reads', async () => {
    const { run } = await workspace('vault-events');
    const created = run(['create', 'notes/plan.md', '--content', '# Plan']);
    expect(created.status, created.stdout).toBe(0);
    const revision = created.body.data.changes[0].revision;
    expect(created.body.events).toEqual([
      { id: 'vault.create', payload: { path: 'notes', kind: 'folder', operation: 'created' } },
      { id: 'vault.create', payload: { path: 'notes/plan.md', kind: 'file', operation: 'created', revision, bytes: 6 } },
    ]);
    const preview = run(['--events', 'all', 'write', 'notes/plan.md', '--content', '# Plan v2', '--if-match', revision, '--dry-run']);
    expect(preview.body.events.filter((event: Record) => event.id === 'workspace.quick-preview')).toEqual([
      { id: 'workspace.quick-preview', payload: { path: 'notes/plan.md', operation: 'updated', bytes: 9 } },
    ]);
    expect(ids(preview.body.events).some(id => id.startsWith('vault.'))).toBe(false);
    const modified = run(['write', 'notes/plan.md', '--content', '# Plan v2', '--if-match', revision]);
    expect(ids(modified.body.events)).toEqual(['vault.modify']);
    expect(modified.body.events[0].payload).toMatchObject({ path: 'notes/plan.md', kind: 'file', operation: 'updated', bytes: 9 });
    const read = run(['--events', 'all', 'read', 'notes/plan.md']);
    // The bundled core plugins register, activate and unload around every activating command.
    const each = (...phases: string[]) => bundledCorePlugins.flatMap(() => phases);
    expect(ids(read.body.events)).toEqual([
      ...each('plugin.registered'), 'command.started', ...each('plugin.activating', 'plugin.activated'), 'workspace.layout-ready',
      'operation.started', 'workspace.file-open', 'operation.succeeded', 'command.succeeded', 'workspace.quit', ...each('plugin.unloading', 'plugin.unloaded'),
    ]);
    expect(read.body.events.slice(0, bundledCorePlugins.length).map((event: Record) => event.payload)).toEqual(bundledCorePlugins.map(pluginId => ({ pluginId })));
    expect(read.body.events.find((event: Record) => event.id === 'workspace.file-open').payload).toEqual({ path: 'notes/plan.md' });
    expect(run(['read', 'notes/plan.md']).body.events).toEqual([]);
  });

  it('emits workspace.project-change when project open or close changes the selection', async () => {
    const { run } = await workspace('project-events');
    for (const name of ['alpha', 'beta']) expect(run(['project', 'create', name]).status).toBe(0);
    const change = (args: string[]) => run(['--events', 'all', ...args]).body.events.filter((event: Record) => event.id === 'workspace.project-change').map((event: Record) => event.payload);
    expect(change(['project', 'open', 'alpha'])).toEqual([{ from: null, to: 'alpha' }]);
    expect(change(['project', 'open', 'alpha'])).toEqual([]);
    expect(change(['project', 'open', 'beta', '--dry-run'])).toEqual([]);
    expect(change(['project', 'open', 'beta'])).toEqual([{ from: 'alpha', to: 'beta' }]);
    expect(change(['project', 'close'])).toEqual([{ from: 'beta', to: null }]);
  });

  it('publishes metadataCache events after vault records once a command loaded the cache', async () => {
    const { run } = await workspace('metadata-events', `
      const text = value => new TextEncoder().encode(value);
      export default {
        onload(context) { context.events.on('metadataCache.resolved', () => context.events.warn('resolved observed')); },
        commands: [{ id: 'parity.link', description: 'Link a note after loading the cache', usage: 'parity.link <path> <target>', async run([path, target], flags, context) {
          const cache = await context.metadata.load();
          const before = cache.resolvedLinks[path];
          const { revision } = await context.workspace.read(path);
          await context.workspace.write([{ path, bytes: text('See [[' + target + ']].'), expectedRevision: revision }]);
          return { before, after: cache.resolvedLinks[path] };
        } }],
      };
    `);
    expect(run(['create', 'notes/plan.md', '--content', '# Plan']).status).toBe(0);
    const created = run(['--events', 'all', 'create', 'notes/spec.md', '--content', 'Draft']);
    expect(ids(created.body.events).some(id => id.startsWith('metadataCache.'))).toBe(false);
    const linked = run(['--events', 'all', 'parity.link', 'notes/spec.md', 'plan']);
    expect(linked.status, linked.stdout).toBe(0);
    expect(linked.body.data).toEqual({ before: {}, after: { 'notes/plan.md': 1 } });
    const records = linked.body.events.filter((event: Record) => /^(vault|metadataCache)\./.test(event.id));
    expect(records.map((event: Record) => [event.id, event.payload.path])).toEqual([
      ['vault.modify', 'notes/spec.md'], ['metadataCache.changed', 'notes/spec.md'], ['metadataCache.resolve', 'notes/spec.md'], ['metadataCache.resolved', undefined],
    ]);
    expect(records[1].payload.cache).toMatchObject({ links: [{ link: 'plan', original: '[[plan]]' }] });
    expect(linked.body.warnings).toEqual(['resolved observed']);
    const changes = run(['parity.link', 'notes/spec.md', 'missing']);
    expect(ids(changes.body.events)).toEqual(['vault.modify']);
  });

  it('runs onUserEnable once, onLayoutReady and quit tasks, and rejects host-event emission by plugins', async () => {
    const { root, run } = await workspace('plugin-hooks', `
      export default {
        events: [{ id: 'parity.ready', validate: value => value !== null && typeof value === 'object' }],
        onload(context) {
          context.events.onLayoutReady(() => context.events.emit('parity.ready', { phase: 'layout' }));
          context.events.onQuit(() => context.events.warn('quit task ran'));
        },
        onUserEnable(context) { context.events.warn('enabled once'); },
        commands: [{ id: 'parity.forge', description: 'Try to emit a host event', usage: 'parity.forge', async run(args, flags, context) {
          await context.events.emit('vault.create', { path: 'fake.md', kind: 'file', operation: 'created', revision: 'x', bytes: 1 });
          return {};
        } }, { id: 'parity.noop', description: 'Do nothing', usage: 'parity.noop', run() { return { ok: true }; } }],
      };
    `);
    const first = run(['--events', 'all', 'parity.noop']);
    expect(first.status, first.stdout).toBe(0);
    expect(first.body.warnings).toEqual(['enabled once', 'quit task ran']);
    const order = ids(first.body.events);
    expect(order.indexOf('parity.ready')).toBeLessThan(order.indexOf('workspace.layout-ready'));
    expect(order.indexOf('workspace.layout-ready')).toBeLessThan(order.indexOf('command.succeeded'));
    expect(order.indexOf('workspace.quit')).toBeLessThan(order.indexOf('plugin.unloading'));
    expect(first.body.events.filter((event: Record) => event.id.startsWith('vault.')).map((event: Record) => event.payload.path)).toEqual(['bin/data', 'bin/data/plugins-state.json']);
    expect(JSON.parse(await readFile(join(root, 'bin/data/plugins-state.json'), 'utf8'))).toEqual({ schemaVersion: 1, plugins: { parity: { settings: null } } });
    const second = run(['parity.noop']);
    expect(second.body.warnings).toEqual(['quit task ran']);
    expect(second.body.events).toEqual([]);
    const forged = run(['parity.forge']);
    expect(forged.status).toBe(2);
    expect(forged.body.error).toMatchObject({ code: 'EVENT_OWNERSHIP', retryable: false });
    await expect(readFile(join(root, 'fake.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
