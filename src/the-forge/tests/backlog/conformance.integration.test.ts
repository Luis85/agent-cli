import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { backlogFixtures, backlogVault, runBacklog } from '../support/backlog.ts';

// Conformance against notes and the base written by backlog-view itself (fixtures copied from fb813df docs/).
let vault: Awaited<ReturnType<typeof backlogVault>>;
beforeEach(async () => { vault = await backlogVault(); });
afterEach(async () => { await vault.dispose(); });

const expected = (name: string) => readFile(join(backlogFixtures, 'expected', name), 'utf8');
const today = '2026-10-01';
/** Every line of `after` equals the line of `before` except the listed replacements. */
function changedLines(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split('\n'), b = after.split('\n');
  return { removed: a.filter(line => !b.includes(line)), added: b.filter(line => !a.includes(line)) };
}

describe('reading plugin-written notes', () => {
  it('reads the plugin\'s own base, hierarchy, global ranks, states and releases', async () => {
    const { data } = await runBacklog(vault.root, ['list']);
    expect(data).toMatchObject({ base: 'docs/Product Backlog.base', view: 'Backlog', total: 13, ignored: [] });
    expect(data.items.map((item: { title: string; rank: number }) => [item.rank, item.title])).toEqual([
      [1, 'Product Kanban'], [2, 'Dependencies'], [3, 'Codebase health'], [4, 'Product Strategy'], [5, 'Eratic Skunk'], [6, 'One file per concern'],
      [7, 'Creating a card in a column\'s state'], [8, 'Feisty Reindeer'], [9, 'Linking two items'], [10, 'Smoke test the board'], [11, 'Creating a card in a column'],
      [12, 'A Deliverables board'], [13, 'Split the row renderer'],
    ]);
    const card = data.items.find((item: { title: string }) => item.title === 'Creating a card in a column');
    expect(card).toMatchObject({ type: 'Test case', ladder: 'test', parent: 'docs/tests/suites/Smoke test the board.md', state: 'Open', priority: 'P3', start: null, horizon: null,
      dependsOn: ['docs/tasks/Creating a card in a column\'s state.md'], brokenDependencies: [{ raw: '[[Creation from the column\'s three inputs]]', reason: 'unresolved' }] });
    const health = data.items.find((item: { title: string }) => item.title === 'Codebase health');
    expect(health).toMatchObject({ assignee: { raw: '[[Josh]]', path: 'docs/resources/Josh.md' }, release: { raw: '[[Feisty Reindeer]]', path: 'docs/releases/Feisty Reindeer.md' }, risk: null });
    const board = (await runBacklog(vault.root, ['board'])).data;
    expect(board.columns.map((column: { state: string | null; count: number }) => [column.state, column.count])).toEqual([[null, 0], ['Open', 4], ['Active', 1], ['Done', 4]]);
  });

  it('lists the plugin\'s releases with readiness from its release view', async () => {
    const releases = (await runBacklog(vault.root, ['release', 'list'], { today })).data;
    expect(releases.releases.map((row: { name: string; members: { value: number }; done: { value: number }; overdue: boolean; target: { value: string } }) => [row.name, row.members.value, row.done.value, row.target.value, row.overdue]))
      .toEqual([['Eratic Skunk', 4, 2, '2026-10-02', false], ['Feisty Reindeer', 1, 0, '2026-11-01', false]]);
    const readiness = (await runBacklog(vault.root, ['release', 'readiness', 'Eratic Skunk'], { today })).data;
    expect(readiness.members).toBe(4);
    expect(readiness.criteria.map((criterion: { key: string; verdict: string }) => [criterion.key, criterion.verdict])).toEqual([['estimated', 'not'], ['blocked', 'satisfied'], ['risk', 'unconfigured']]);
  });
});

describe('writing plugin-written notes', () => {
  it('changes only the intended keys and keeps every other byte', async () => {
    const path = 'docs/requirements/Codebase health.md';
    const before = await vault.read(path);
    const { data } = await runBacklog(vault.root, ['set', 'Codebase health'], { priority: 'p1', today });
    expect(data.changes).toHaveLength(1);
    const after = await vault.read(path);
    expect(changedLines(before, after)).toEqual({ removed: ['priority: ""'], added: ['priority: P1'] });
    expect(after.slice(after.indexOf('\n---\n'))).toBe(before.slice(before.indexOf('\n---\n')));

    const linking = 'docs/requirements/Linking two items.md';
    const original = await vault.read(linking);
    await runBacklog(vault.root, ['set', 'Linking two items'], { state: 'Active', today });
    // Leaving done deletes the finished stamp; no started state is configured, so nothing is stamped.
    expect(changedLines(original, await vault.read(linking))).toEqual({ removed: ['status: Done', 'finished: ""'], added: ['status: Active'] });
  });

  it('round-trips every plugin-written fixture note: a write changes only its own line', async () => {
    const { data } = await runBacklog(vault.root, ['list']);
    for (const { path } of data.items as Array<{ path: string }>) {
      const before = await vault.read(path);
      const held = before.split('\n').find(line => line.startsWith('priority:'));
      const result = (await runBacklog(vault.root, ['set', path], { priority: 'P2' })).data;
      const after = await vault.read(path);
      if (held === 'priority: P2') expect(result.changes, path).toEqual([]);
      else expect(changedLines(before, after), path).toEqual({ removed: held === undefined ? [] : [held], added: ['priority: P2'] });
      expect(after.length - before.length, path).toBe('priority: P2'.length - (held?.length ?? -1));
    }
  });

  it('moves with one order write and joins a release without overwriting stated dates', async () => {
    const strategy = 'docs/requirements/Product Strategy.md';
    const before = await vault.read(strategy);
    const moved = await runBacklog(vault.root, ['move', 'Product Strategy'], { before: 'Codebase health' });
    expect(moved.data.item).toEqual({ path: strategy, parent: null, order: 1.709, previousParent: null, previousOrder: 4.0625 });
    expect(changedLines(before, await vault.read(strategy))).toEqual({ removed: ['order: 4.0625'], added: ['order: 1.709'] });
    expect(moved.events).toEqual([{ id: 'backlog.item-moved', payload: moved.data.item }]);

    const linking = 'docs/requirements/Linking two items.md';
    const original = await vault.read(linking);
    await runBacklog(vault.root, ['release', 'join', 'Linking two items', 'Feisty Reindeer'], { today });
    // due is stated (2026-08-08) and a start of today would reverse the span, so only the link lands.
    expect(changedLines(original, await vault.read(linking))).toEqual({ removed: [], added: ['release: "[[Feisty Reindeer]]"'] });
  });

  it('creates notes byte for byte like createBacklogItem and createRelease', async () => {
    const epic = await runBacklog(vault.root, ['add', 'Epic', 'Route: sharing / export?'], { today });
    expect(epic.data.item).toMatchObject({ path: 'docs/requirements/Route- sharing - export.md', id: 1, order: 41 });
    expect(await vault.read('docs/requirements/Route- sharing - export.md')).toBe(await expected('Route- sharing - export.md'));
    expect(epic.events.map(event => event.id)).toEqual(['backlog.item-created']);
    await runBacklog(vault.root, ['add', 'Feature', 'Share a route'], { parent: 'Product Strategy' });
    expect(await vault.read('docs/requirements/Share a route.md')).toBe(await expected('Share a route.md'));
    await runBacklog(vault.root, ['release', 'add', '1.2'], { 'release-version': '1.2.0', 'target-date': '2026-12-01', status: 'Open' });
    expect(await vault.read('docs/releases/1.2.md')).toBe(await expected('1.2.md'));
    const scaffold = await runBacklog(vault.root, ['init']);
    expect(scaffold.data.path).toBe('docs/Product Backlog 1.base');
    expect(await vault.read('docs/Product Backlog 1.base')).toBe('filters:\n  and:\n    - "file.inFolder(\\"docs\\")"\n    - file.ext == "md"\nviews:\n  - type: product-backlog\n    name: Backlog\n    homeFolder: "docs"\n');
  });

  it('generates byte-compatible release notes, refuses foreign files and marks a release released', async () => {
    const notes = await runBacklog(vault.root, ['release', 'notes', 'Eratic Skunk']);
    expect(notes.data).toMatchObject({ path: 'docs/release-notes/Eratic Skunk release notes.md', outcome: 'created' });
    expect(await vault.read('docs/release-notes/Eratic Skunk release notes.md')).toBe(await expected('Eratic Skunk release notes.md'));
    expect((await runBacklog(vault.root, ['release', 'notes', 'Eratic Skunk'])).data.outcome).toBe('unchanged');
    await vault.write('docs/release-notes/Feisty Reindeer release notes.md', '# Written by hand\n');
    await expect(runBacklog(vault.root, ['release', 'notes', 'Feisty Reindeer'])).rejects.toMatchObject({ code: 'BACKLOG_WRITE_REFUSED', details: { reason: 'foreign-release-notes' } });

    const release = 'docs/releases/Eratic Skunk.md';
    const before = await vault.read(release);
    const marked = await runBacklog(vault.root, ['release', 'mark-released', 'Eratic Skunk'], { today: '2026-10-02' });
    expect(changedLines(before, await vault.read(release))).toEqual({ removed: ['status: Open'], added: ['status: Released', 'released: 2026-10-02'] });
    expect(marked.events).toEqual([{ id: 'backlog.released', payload: { path: release, name: 'Eratic Skunk', status: 'Released', released: '2026-10-02' } }]);
    await expect(runBacklog(vault.root, ['release', 'mark-released', 'Eratic Skunk'])).rejects.toMatchObject({ code: 'BACKLOG_WRITE_REFUSED', details: { reason: 'already-released' } });
  });

  it('previews with diffs and refuses what the plugin refuses', async () => {
    const preview = await runBacklog(vault.root, ['add', 'Task', 'Preview'], {}, { dryRun: true });
    expect(preview.data.changes[0]).toMatchObject({ path: 'docs/tasks/Preview.md', operation: 'created', diff: expect.stringContaining('+type: Task') });
    expect(preview.events).toEqual([]);
    await expect(vault.read('docs/tasks/Preview.md')).rejects.toThrow();
    await expect(runBacklog(vault.root, ['set', 'Eratic Skunk'], { horizon: 'Now' })).rejects.toMatchObject({ code: 'BACKLOG_WRITE_REFUSED', details: { reason: 'field-not-held' } });
    await expect(runBacklog(vault.root, ['release', 'join', 'Smoke test the board', 'Eratic Skunk'])).rejects.toMatchObject({ details: { reason: 'field-not-held' } });
    await expect(runBacklog(vault.root, ['release', 'join', 'Linking two items', 'Product Kanban'])).rejects.toMatchObject({ details: { reason: 'not-a-release' } });
    await expect(runBacklog(vault.root, ['set', 'Linking two items'], { assignee: 'Product Kanban' })).rejects.toMatchObject({ details: { reason: 'not-a-resource' } });
    await expect(runBacklog(vault.root, ['move', 'Product Kanban'], { parent: 'A Deliverables board' })).rejects.toMatchObject({ details: { reason: 'parent-cycle' } });
    await expect(runBacklog(vault.root, ['move', 'Split the row renderer'], { parent: 'Smoke test the board' })).rejects.toMatchObject({ details: { reason: 'projection' } });
    await expect(runBacklog(vault.root, ['depend', 'Creating a card in a column\'s state'], { on: 'Creating a card in a column' })).rejects.toMatchObject({ details: { reason: 'dependency-cycle' } });
    await expect(runBacklog(vault.root, ['move', 'Product Strategy'], { after: 'One file per concern' })).rejects.toMatchObject({ code: 'BACKLOG_NO_GAP', details: { reason: 'tied' } });
    await expect(runBacklog(vault.root, ['show', 'Nothing'])).rejects.toMatchObject({ code: 'BACKLOG_NOT_FOUND' });
  });
});
