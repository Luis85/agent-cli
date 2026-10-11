import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backlogVault } from '../support/backlog.ts';
import { FakeAzureDevOps } from '../support/azure-devops.ts';
import { TOKEN_ENV, azureConnection, invocation, noteText, planningNotes, run } from '../support/connectors.ts';

const PAT = 'pat-secret-value-0123456789';
const env = { [TOKEN_ENV]: PAT };
const note = noteText;
const planning = planningNotes();

let fake: FakeAzureDevOps;
let vault: Awaited<ReturnType<typeof backlogVault>> | undefined;
beforeAll(async () => { fake = await new FakeAzureDevOps(PAT, { contoso: 'Trailhead', fabrikam: 'Delivery' }).start(); });
afterAll(async () => { await fake.close(); });
afterEach(async () => { await vault?.dispose(); vault = undefined; });

const connections = () => ({ contoso: azureConnection(fake, 'contoso', 'Trailhead'), fabrikam: azureConnection(fake, 'fabrikam', 'Delivery') });
const sync = (flags: Record<string, string | boolean> = {}, options: { dryRun?: boolean } = {}) => run(vault!.root, connections(), 'backlog', ['sync'], flags, { env, ...options });
const items = (organization: string) => fake.list(organization).filter(item => item.fields['System.Title'] !== undefined);

describe('pushing a new backlog', () => {
  it('creates work items parents first with parent links, then writes link properties and the sync state', async () => {
    vault = await backlogVault(planning);
    const before = fake.list('contoso').length;
    const result = await sync();
    // The platform starts the Feature, which has no state, in New: the value it applied lands in the note.
    expect(result.data.counts).toMatchObject({ created: 3, updated: 0, pulled: 1, conflicts: 0, failed: 0, left: 0 });
    expect(result.data.views[0].pulled).toEqual([expect.objectContaining({ path: 'work/Itinerary builder.md', fields: ['state'] })]);
    expect(await vault.read('work/Itinerary builder.md')).toContain('status: New');
    const created = fake.list('contoso').slice(before);
    expect(created.map(item => [item.fields['System.WorkItemType'], item.fields['System.Title']])).toEqual([['Epic', 'Trip planning'], ['Feature', 'Itinerary builder'], ['User Story', 'Draft a trip']]);
    const [epic, feature, story] = created;
    expect(feature!.relations).toEqual([{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${fake.organization('contoso')}/_apis/wit/workItems/${epic!.id}` }]);
    expect(story!.relations[0]!.url).toMatch(new RegExp(`/workItems/${feature!.id}$`));
    expect(story!.fields).toMatchObject({ 'System.State': 'New', 'Microsoft.VSTS.Common.Priority': 1, 'System.Description': 'Plan the **stops**.' });
    expect(story!.multilineFieldsFormat).toEqual({ 'System.Description': 'markdown' });
    expect(epic!.fields).toMatchObject({ 'System.State': 'Active', 'System.Tags': 'planning' });
    expect(await vault.read('work/Draft a trip.md')).toBe(`---\ntype: "PBI"\nparent: "[[Itinerary builder]]"\norder: 3000\nstatus: "Open"\npriority: "1 - Must"\nazure-devops: ${fake.organization('contoso')}/Trailhead/_workitems/edit/${story!.id}\n---\nPlan the **stops**.\n`);
    const state = JSON.parse(await vault.read('.forge/sync/contoso.json'));
    expect(Object.keys(state.items)).toEqual(['work/Draft a trip.md', 'work/Itinerary builder.md', 'work/Trip planning.md']);
    expect(state.items['work/Draft a trip.md']).toMatchObject({ id: String(story!.id), rev: String(story!.rev), fields: { title: expect.stringMatching(/^[0-9a-f]{16}$/) } });
    expect(result.events.filter(record => record.id.startsWith('connector.') || record.id === 'backlog.synced').map(record => record.id)).toEqual(['connector.pushed', 'connector.pushed', 'connector.pushed', 'connector.pulled', 'backlog.synced']);
    const writes = fake.writes().length;
    const again = await sync();
    expect(again.data.counts).toMatchObject({ created: 0, updated: 0, pulled: 0, conflicts: 0 });
    expect(again.data.views[0].unchanged).toBe(3);
    expect(fake.writes().length).toBe(writes);
    expect(again.data.changes).toEqual([]);
  });
});

describe('two-way changes', () => {
  async function linked() {
    vault = await backlogVault(planning);
    await sync();
    const state = JSON.parse(await vault.read('.forge/sync/contoso.json'));
    return (path: string) => Number(state.items[path].id);
  }

  it('pulls a remote state change into the note with the backlog write rules', async () => {
    const id = await linked();
    fake.edit('contoso', id('work/Draft a trip.md'), { 'System.State': 'Active', 'Microsoft.VSTS.Common.Priority': 2 });
    const result = await sync();
    expect(result.data.views[0].pulled).toEqual([expect.objectContaining({ path: 'work/Draft a trip.md', fields: ['state', 'priority'] })]);
    expect(await vault!.read('work/Draft a trip.md')).toContain('status: Active\npriority: 2 - Should\n');
    expect(result.events.map(record => record.id)).toContain('connector.pulled');
    expect((await sync()).data.counts).toMatchObject({ pulled: 0, updated: 0, conflicts: 0 });
  });

  it('pushes a local change with a revision guard and follows a remote re-parent', async () => {
    const id = await linked();
    await vault!.write('work/Draft a trip.md', (await vault!.read('work/Draft a trip.md')).replace('status: "Open"', 'status: "Done"'));
    const pushed = await sync();
    expect(pushed.data.views[0].updated).toEqual([expect.objectContaining({ path: 'work/Draft a trip.md', fields: ['state'] })]);
    expect(fake.item('contoso', id('work/Draft a trip.md')).fields['System.State']).toBe('Closed');
    const update = fake.writes().at(-1)!;
    expect((update.body as Array<{ op: string }>)[0]).toEqual({ op: 'test', path: '/rev', value: expect.any(Number) });
    fake.reparent('contoso', id('work/Draft a trip.md'), id('work/Trip planning.md'));
    await sync();
    expect(await vault!.read('work/Draft a trip.md')).toContain('parent: "[[Trip planning]]"');
  });

  it('reports a title changed on both sides as a conflict, changes nothing, and resolves either way', async () => {
    const id = await linked();
    const session = await invocation(vault!.root, connections(), { env });
    await session.context.app.fileManager.move('work/Draft a trip.md', 'work/Draft a trip itinerary.md');
    expect(Object.keys(JSON.parse(await vault!.read('.forge/sync/contoso.json')).items)).toContain('work/Draft a trip itinerary.md');
    fake.edit('contoso', id('work/Draft a trip.md'), { 'System.Title': 'Draft the trip' });
    const writes = fake.writes().length;
    const text = await vault!.read('work/Draft a trip itinerary.md');
    const result = await sync();
    expect(result.data.views[0].conflicts).toEqual([expect.objectContaining({ path: 'work/Draft a trip itinerary.md', fields: [{ field: 'title', local: 'Draft a trip itinerary', remote: 'Draft the trip' }] })]);
    expect(result.events.filter(record => record.id === 'connector.conflict')).toHaveLength(1);
    expect(fake.writes().length).toBe(writes);
    expect(await vault!.read('work/Draft a trip itinerary.md')).toBe(text);
    expect((await run(vault!.root, connections(), 'backlog', ['sync', 'status'], {}, { env })).data.counts.conflicts).toBe(1);
    await expect(run(vault!.root, connections(), 'backlog', ['sync', 'resolve', 'Draft a trip itinerary'], { take: 'local', field: 'state' }, { env })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const resolved = await run(vault!.root, connections(), 'backlog', ['sync', 'resolve', 'Draft a trip itinerary'], { take: 'remote' }, { env });
    expect(resolved.data.views[0].resolved).toEqual([{ path: 'work/Draft a trip itinerary.md', take: 'remote', fields: ['title'] }]);
    expect(existsSync(join(vault!.root, 'work/Draft the trip.md'))).toBe(true);
    expect((await sync()).data.counts.conflicts).toBe(0);
    fake.edit('contoso', id('work/Draft a trip.md'), { 'Microsoft.VSTS.Common.Priority': 3 });
    await vault!.write('work/Draft the trip.md', (await vault!.read('work/Draft the trip.md')).replace('priority: "1 - Must"', 'priority: "2 - Should"'));
    await run(vault!.root, connections(), 'backlog', ['sync', 'resolve', 'Draft the trip'], { take: 'local', field: 'priority' }, { env });
    expect(fake.item('contoso', id('work/Draft a trip.md')).fields['Microsoft.VSTS.Common.Priority']).toBe(2);
  });

  it('reads the remote on a dry run but writes nowhere', async () => {
    vault = await backlogVault(planning);
    const created = fake.writes().length;
    const planned = await sync({}, { dryRun: true });
    expect(planned.data).toMatchObject({ dryRun: true, counts: { created: 3 }, changes: [] });
    expect(planned.data.views[0].created.map((entry: { path: string; remoteId: null }) => [entry.path, entry.remoteId])).toEqual([['work/Trip planning.md', null], ['work/Itinerary builder.md', null], ['work/Draft a trip.md', null]]);
    expect(fake.writes().length).toBe(created);
    expect(existsSync(join(vault.root, '.forge'))).toBe(false);
    await vault.dispose();
    const id = await linked();
    fake.edit('contoso', id('work/Draft a trip.md'), { 'System.State': 'Resolved' });
    const writes = fake.writes().length, reads = fake.requests.length;
    const text = await vault!.read('work/Draft a trip.md');
    const preview = await sync({}, { dryRun: true });
    expect(preview.data.views[0].pulled).toEqual([expect.objectContaining({ fields: ['state'] })]);
    expect(preview.data.changes.find((change: { path: string }) => change.path === 'work/Draft a trip.md').diff).toContain('+status: Resolved');
    expect(fake.requests.length).toBeGreaterThan(reads);
    expect(fake.writes().length).toBe(writes);
    expect(await vault!.read('work/Draft a trip.md')).toBe(text);
    expect(preview.events.filter(record => record.id.startsWith('vault.') || record.id.startsWith('connector.'))).toEqual([]);
  });
});

describe('connections', () => {
  it('syncs two views of one repository to two organizations', async () => {
    vault = await backlogVault({
      'Sync.base': `filters:\n  and:\n    - file.ext == "md"\nviews:\n  - type: product-backlog\n    name: Planning\n    filters:\n      and:\n        - file.inFolder("plan")\n    connection: contoso\n  - type: product-backlog\n    name: Delivery\n    filters:\n      and:\n        - file.inFolder("deliver")\n    connection: fabrikam\n`,
      'plan/Roadmap.md': note({ type: 'Epic', order: 1 }),
      'deliver/Fix login.md': note({ type: 'Bug', order: 2 }),
    });
    const before = { contoso: items('contoso').length, fabrikam: items('fabrikam').length };
    const result = await sync();
    expect(result.data.views.map((view: { view: string; connection: string; created: unknown[] }) => [view.view, view.connection, view.created.length])).toEqual([['Planning', 'contoso', 1], ['Delivery', 'fabrikam', 1]]);
    expect(items('contoso').slice(before.contoso).map(item => item.fields['System.Title'])).toEqual(['Roadmap']);
    expect(items('fabrikam').slice(before.fabrikam).map(item => [item.fields['System.WorkItemType'], item.fields['System.Title']])).toEqual([['Bug', 'Fix login']]);
    expect(await vault.read('deliver/Fix login.md')).toContain(`azure-devops: ${fake.organization('fabrikam')}/Delivery/_workitems/edit/`);
    expect((await run(vault.root, connections(), 'backlog', ['sync'], { view: 'Delivery' }, { env })).data.views.map((view: { view: string }) => view.view)).toEqual(['Delivery']);
    expect((await run(vault.root, connections(), 'backlog', ['list'], { view: 'Delivery' }, { env })).data.total).toBe(1);
  });

  it('never puts credentials into results, events or errors', async () => {
    vault = await backlogVault(planning);
    const result = await sync();
    expect(result.output).not.toContain(PAT);
    expect(result.output).not.toContain(Buffer.from(`:${PAT}`).toString('base64'));
    const listed = await run(vault.root, connections(), 'connectors', ['list'], {}, { env });
    expect(listed.data.connections[0]).toMatchObject({ id: 'contoso', tokenEnv: TOKEN_ENV, tokenSet: true, valid: true });
    expect(JSON.stringify(listed.data)).not.toContain(PAT);
    const refused = await run(vault.root, connections(), 'connectors', ['test', 'contoso'], {}, { env: { [TOKEN_ENV]: 'wrong-token-value' } }).catch(error => error);
    expect(refused).toMatchObject({ code: 'CONNECTOR_AUTH_FAILED', details: { status: 401, tokenEnv: TOKEN_ENV } });
    expect(JSON.stringify({ message: refused.message, details: refused.details })).not.toContain('wrong-token-value');
    await expect(run(vault.root, connections(), 'backlog', ['sync'], {}, { env: {} })).rejects.toMatchObject({ code: 'CONNECTOR_AUTH_FAILED', details: { tokenEnv: TOKEN_ENV } });
  });
});
