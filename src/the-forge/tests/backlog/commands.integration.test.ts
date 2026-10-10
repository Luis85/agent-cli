import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../src/application/plugins/events.ts';
import { registerHostEvents } from '../../src/application/plugins/host-events.ts';
import { Registry } from '../../src/application/plugins/registry.ts';
import { registerCorePlugins, registrySkills } from '../../src/application/plugins/core-plugins.ts';
import { NodeEventScope } from '../../src/infrastructure/plugins/event-scope.ts';
import { nodeFileDates } from '../../src/infrastructure/workspace/file-dates.ts';
import { basesPlugin } from '../../src/plugins/bases/plugin.ts';
import { backlogPlugin } from '../../src/plugins/backlog/plugin.ts';
import { backlogVault, runBacklog } from '../support/backlog.ts';

const base = (folder: string, extra = '') => `filters:\n  and:\n    - file.inFolder("${folder}")\nviews:\n  - type: product-backlog\n    name: Backlog\n    homeFolder: ${folder}\n    stateProperty: note.status\n    dependsOnProperty: note.dependsOn\n${extra}`;
const note = (fields: Record<string, unknown>) => `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n`;
let vault: Awaited<ReturnType<typeof backlogVault>> | undefined;
afterEach(async () => { await vault?.dispose(); vault = undefined; });

describe('choosing the backlog', () => {
  it('discovers the single backlog view, reports ambiguity with candidates and honours --base, --view and plugin settings', async () => {
    vault = await backlogVault({ 'a/Backlog.base': base('a'), 'a/Epic.md': note({ type: 'Epic', order: 1 }) });
    expect((await runBacklog(vault.root, ['list'])).data).toMatchObject({ base: 'a/Backlog.base', view: 'Backlog', total: 1 });
    await vault.write('b/Backlog.base', base('b'));
    await expect(runBacklog(vault.root, ['list'])).rejects.toMatchObject({ code: 'BACKLOG_AMBIGUOUS', details: { candidates: [{ base: 'a/Backlog.base', view: 'Backlog' }, { base: 'b/Backlog.base', view: 'Backlog' }] } });
    expect((await runBacklog(vault.root, ['list'], { base: 'b/Backlog.base' })).data.total).toBe(0);
    expect((await runBacklog(vault.root, ['list'], {}, { settings: { base: 'a/Backlog.base' } })).data.total).toBe(1);
    await expect(runBacklog(vault.root, ['list'], { base: 'a/Backlog.base', view: 'Board' })).rejects.toMatchObject({ code: 'BACKLOG_NOT_FOUND', details: { views: ['Backlog'] } });
    await expect(runBacklog(vault.root, ['list'], { base: 'missing.base' })).rejects.toMatchObject({ code: 'BACKLOG_NOT_FOUND' });
    await expect(runBacklog(vault.root, ['list'], { folder: 'x' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('is disabled together with the bases plugin whose service it requires', () => {
    const registry = new Registry(), events = new EventBus(new NodeEventScope());
    registerHostEvents(events);
    registerCorePlugins(registry, events, [basesPlugin, backlogPlugin], { skills: registrySkills(registry), fileDates: nodeFileDates }, ['bases']);
    expect(registry.disabled.map(manifest => manifest.id)).toEqual(['bases', 'backlog']);
    expect(registry.commands.has('backlog')).toBe(false);
  });
});

describe('the write gate', () => {
  it('refuses every write while two roles share one key, and writes to context rows', async () => {
    vault = await backlogVault({
      'w/Backlog.base': base('w/items', '    horizonProperty: note.order\n'),
      'w/items/Story.md': note({ type: 'PBI', parent: '[[Epic]]', order: 2 }),
      'w/Epic.md': note({ type: 'Epic', order: 1 }),
    });
    await expect(runBacklog(vault.root, ['set', 'Story'], { state: 'Open' })).rejects.toMatchObject({ code: 'BACKLOG_CONFIG_PROBLEM', details: { problems: ['The properties order, horizon all use the key "order".'] } });
    expect((await runBacklog(vault.root, ['check'])).data).toMatchObject({ ok: false, writable: false, problems: [{ code: 'config' }] });
    await vault.write('w/Backlog.base', base('w/items'));
    expect((await runBacklog(vault.root, ['list'], { context: true })).data.items.map((item: { title: string; context: boolean }) => [item.title, item.context])).toEqual([['Epic', true], ['Story', false]]);
    await expect(runBacklog(vault.root, ['set', 'Epic'], { state: 'Open' })).rejects.toMatchObject({ code: 'BACKLOG_WRITE_REFUSED', details: { reason: 'outside-filter' } });
    await expect(runBacklog(vault.root, ['set', 'Story'], { priority: 'P1' })).rejects.toMatchObject({ details: { reason: 'unbound-property' } });
  });
});

describe('ranks and dependencies', () => {
  it('seeds ranks in tree preorder and respaces them in rank order around fixed context ranks', async () => {
    vault = await backlogVault({
      'r/Backlog.base': base('r'),
      'r/A.md': note({ type: 'Epic', order: 5 }), 'r/B.md': note({ type: 'Feature', parent: '[[A]]', order: 1 }),
      'r/C.md': note({ type: 'Epic' }), 'r/D.md': note({ type: 'Feature', parent: '[[C]]', order: 3 }),
    });
    const seeded = await runBacklog(vault.root, ['ranks', 'seed']);
    expect(seeded.data.ranked).toBe(4);
    expect((await runBacklog(vault.root, ['list'])).data.items.map((item: { title: string; order: number }) => [item.title, item.order])).toEqual([['A', 1000], ['B', 2000], ['C', 3000], ['D', 4000]]);
    expect((await runBacklog(vault.root, ['ranks', 'seed'])).data.changes).toEqual([]);
    await runBacklog(vault.root, ['move', 'D'], { first: true });
    await runBacklog(vault.root, ['move', 'C'], { top: true, first: true });
    const respaced = await runBacklog(vault.root, ['ranks', 'respace']);
    expect(respaced.data.changes.length).toBeGreaterThan(0);
    expect((await runBacklog(vault.root, ['tree'])).data.roots.map((root: { title: string; order: number; items: Array<{ title: string; order: number }> }) => [root.title, root.order, root.items.map(item => [item.title, item.order])]))
      .toEqual([['C', 1000, [['D', 4000]]], ['A', 2000, [['B', 3000]]]]);
  });

  it('writes nothing for a move that keeps the parent and the position', async () => {
    const files = {
      'm/Backlog.base': base('m'),
      'm/A.md': note({ type: 'Epic', order: 1000 }), 'm/B.md': note({ type: 'Epic', order: 2000 }),
      'm/C.md': note({ type: 'Feature', parent: '[[A]]', order: 3000 }),
    };
    vault = await backlogVault(files);
    const noOps: Array<[string, Record<string, string | boolean>]> = [
      ['B', { last: true }], ['B', {}], ['A', { first: true }], ['A', { top: true, first: true }], ['C', { first: true }], ['C', { last: true }],
      ['C', { parent: 'A' }], ['B', { after: 'A' }], ['A', { before: 'B' }],
    ];
    for (const [item, flags] of noOps) {
      const moved = await runBacklog(vault.root, ['move', item], flags);
      expect(moved.data.changes, `${item} ${JSON.stringify(flags)}`).toEqual([]);
      expect(moved.events).toEqual([]);
    }
    for (const [path, content] of Object.entries(files)) expect(await vault.read(path)).toBe(content);
    expect((await runBacklog(vault.root, ['move', 'A'], { last: true })).events.map(event => event.id)).toEqual(['backlog.item-moved']);
    expect(await vault.read('m/A.md')).toBe(note({ type: 'Epic', order: 2500 }));
  });

  it('still clears a stale parent link when the position stays', async () => {
    vault = await backlogVault({ 'o/Backlog.base': base('o'), 'o/A.md': note({ type: 'Epic', parent: '[[Gone]]', order: 1000 }) });
    expect((await runBacklog(vault.root, ['move', 'A'], { first: true })).data.changes).toHaveLength(1);
    expect(await vault.read('o/A.md')).toBe(note({ type: 'Epic', order: 1000 }));
    expect((await runBacklog(vault.root, ['move', 'A'], { top: true })).data.changes).toEqual([]);
  });

  it('adds and removes dependsOn entries, deleting the key when the list empties', async () => {
    vault = await backlogVault({ 'd/Backlog.base': base('d'), 'd/A.md': note({ type: 'PBI', order: 1 }), 'd/B.md': note({ type: 'PBI', order: 2 }), 'd/M.md': note({ type: 'Milestone', order: 3 }) });
    await runBacklog(vault.root, ['depend', 'A'], { on: 'B' });
    expect(await vault.read('d/A.md')).toBe('---\ntype: "PBI"\norder: 1\ndependsOn:\n  - "[[B]]"\n---\n');
    expect((await runBacklog(vault.root, ['depend', 'A'], { on: 'B' })).data.changes).toEqual([]);
    expect((await runBacklog(vault.root, ['show', 'B'])).data.dependents).toEqual(['d/A.md']);
    await expect(runBacklog(vault.root, ['depend', 'M'], { on: 'A' })).rejects.toMatchObject({ details: { reason: 'marker' } });
    await runBacklog(vault.root, ['undepend', 'A'], { on: 'B' });
    expect(await vault.read('d/A.md')).toBe('---\ntype: "PBI"\norder: 1\n---\n');
  });
});
