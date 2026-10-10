import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { backlogVault, runBacklog } from '../support/backlog.ts';

const base = [
  'filters:', '  and:', '    - file.inFolder("v")', 'views:', '  - type: product-backlog', '    name: Backlog', '    homeFolder: v',
  '    stateProperty: note.status', '    stateValues: Open, In Progress', '    doneValues: Done', '    startedStates: In Progress',
  '    startedDateProperty: note.started', '    finishedDateProperty: note.finished', '    priorityProperty: note.priority',
  '    deliverableStateProperty: note.stage', '    deliverableStateValues: Draft, Approved', '    deliverableDoneValues: Shipped',
  '    testStateProperty: note.verdict', '    testStateValues: Pending, Passed', '',
].join('\n');
const today = '2026-10-10';
let vault: Awaited<ReturnType<typeof backlogVault>> | undefined;
afterEach(async () => { await vault?.dispose(); vault = undefined; });
const frontmatter = async (path: string) => parse((await vault!.read(path)).split('---\n')[1]!) as Record<string, unknown>;

describe('typed values', () => {
  it('writes states, labels and tags in the spelling the workflow and Obsidian expect', async () => {
    vault = await backlogVault({ 'v/Backlog.base': base });
    const one = await runBacklog(vault.root, ['add', 'PBI', 'One'], { state: 'in progress', tags: '#Alpha, beta alpha  #2026 123,, sprint 12!', today });
    expect(await frontmatter(one.data.item.path)).toMatchObject({ status: 'In Progress', started: today, tags: ['Alpha', 'beta', 'sprint'] });
    const kit = await runBacklog(vault.root, ['add', 'Deliverable', 'Kit'], { state: 'approved', today });
    expect(await frontmatter(kit.data.item.path)).toEqual({ 'pbl-id': 2, type: 'Deliverable', order: 2000, stage: 'Approved' });
    const suite = await runBacklog(vault.root, ['add', 'Test suite', 'Checks'], { state: 'PASSED', today });
    expect(await frontmatter(suite.data.item.path)).toMatchObject({ verdict: 'Passed' });

    const done = await runBacklog(vault.root, ['set', 'One'], { state: 'DONE', priority: '1 - must', today });
    expect(done.events.map(event => event.payload)).toEqual([{ path: one.data.item.path, title: 'One', from: 'In Progress', to: 'Done', finished: today }]);
    expect(await frontmatter(one.data.item.path)).toMatchObject({ status: 'Done', finished: today, priority: '1 - Must' });
    const shipped = await runBacklog(vault.root, ['set', 'Kit'], { state: 'shipped', today });
    expect(shipped.events.map(event => event.payload)).toEqual([{ path: kit.data.item.path, title: 'Kit', from: 'Approved', to: 'Shipped' }]);
    expect(await frontmatter(kit.data.item.path)).toEqual({ 'pbl-id': 2, type: 'Deliverable', order: 2000, stage: 'Shipped' });
    expect((await runBacklog(vault.root, ['set', 'Kit'], { state: 'SHIPPED', today })).data.changes).toEqual([]);
  });
});
