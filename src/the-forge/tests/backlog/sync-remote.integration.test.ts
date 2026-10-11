import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { backlogVault } from '../support/backlog.ts';
import { FakeAzureDevOps } from '../support/azure-devops.ts';
import { TOKEN_ENV, azureConnection, boundBase, noteText, planningNotes, run } from '../support/connectors.ts';

/** What the platform decides on its side (defaults, rules, renames, types and areas) lands in notes without loss. */
const PAT = 'pat-remote-0123456789';
const env = { [TOKEN_ENV]: PAT };
let fake: FakeAzureDevOps;
let vault: Awaited<ReturnType<typeof backlogVault>> | undefined;
beforeAll(async () => { fake = await new FakeAzureDevOps(PAT, { contoso: 'Trailhead' }).start(); });
afterAll(async () => { await fake.close(); });
afterEach(async () => { fake.afterWrite = null; fake.createDefaults = {}; fake.initialStateOnly = false; await vault?.dispose(); vault = undefined; });

const connections = (extra: Record<string, unknown> = {}) => ({ contoso: azureConnection(fake, 'contoso', 'Trailhead', extra) });
const sync = (flags: Record<string, string | boolean> = {}, options: { dryRun?: boolean } = {}) => run(vault!.root, connections(), 'backlog', ['sync'], flags, { env, ...options });
const ids = async () => { const { items } = JSON.parse(await vault!.read('.forge/sync/contoso.json')) as { items: Record<string, { id: string }> }; return (path: string) => Number(items[path]!.id); };
const skipsOf = (result: { data: Record<string, any> }) => result.data.views[0].skipped.map(({ path, field, code }: Record<string, string>) => ({ path, field, code }));

describe('values the platform applies', () => {
  it('pulls defaults and rule values from the created item and reports values it stored differently', async () => {
    vault = await backlogVault({ 'work/Sync.base': boundBase('work', 'Contoso', 'contoso'), 'work/Fresh idea.md': noteText({ type: 'PBI', order: 1 }), 'work/Started.md': noteText({ type: 'PBI', order: 2, status: 'Active', priority: '1 - Must' }) });
    fake.initialStateOnly = true;
    fake.createDefaults = { 'Microsoft.VSTS.Common.Priority': 2 };
    fake.afterWrite = item => { if (item.fields['System.Title'] === 'Started' && item.fields['Microsoft.VSTS.Common.Priority'] === 1) item.fields['Microsoft.VSTS.Common.Priority'] = 4; };
    const result = await sync();
    expect(result.data.counts).toMatchObject({ created: 2, failed: 0 });
    expect(result.data.views[0].pulled).toEqual([expect.objectContaining({ path: 'work/Fresh idea.md', fields: ['state', 'priority'] })]);
    expect(await vault.read('work/Fresh idea.md')).toContain('status: New\npriority: 2 - Should\n');
    const id = await ids();
    expect(fake.item('contoso', id('work/Started.md')).fields['System.State']).toBe('Active');
    expect(skipsOf(result)).toEqual([{ path: 'work/Started.md', field: 'priority', code: 'server-kept' }]);
    expect(await vault.read('work/Started.md')).toContain('priority: "1 - Must"');
    fake.afterWrite = null;
    const again = await sync();
    expect(again.data.views[0].updated).toEqual([expect.objectContaining({ path: 'work/Started.md', fields: ['priority'] })]);
    expect(fake.item('contoso', id('work/Started.md')).fields['Microsoft.VSTS.Common.Priority']).toBe(1);
    expect((await sync()).data.counts).toMatchObject({ created: 0, updated: 0, pulled: 0, conflicts: 0 });
  });

  it('reports applied values on push-only runs and pulls them on the next two-way sync', async () => {
    vault = await backlogVault({ 'work/Sync.base': boundBase('work', 'Contoso', 'contoso'), 'work/Fresh idea.md': noteText({ type: 'PBI', order: 1 }) });
    const pushed = await sync({ direction: 'push' });
    expect(skipsOf(pushed)).toEqual([{ path: 'work/Fresh idea.md', field: 'state', code: 'server-applied' }]);
    expect(await vault.read('work/Fresh idea.md')).not.toContain('status');
    expect((await sync()).data.views[0].pulled).toEqual([expect.objectContaining({ fields: ['state'] })]);
    expect(await vault.read('work/Fresh idea.md')).toContain('status: New');
  });
});

describe('remote renames, types and areas', () => {
  it('links a note re-parented to a note renamed in the same run by its new name, and reports the rename as a change', async () => {
    vault = await backlogVault(planningNotes());
    await sync();
    const id = await ids();
    fake.edit('contoso', id('work/Trip planning.md'), { 'System.Title': 'Trip ideas' });
    fake.reparent('contoso', id('work/Draft a trip.md'), id('work/Trip planning.md'));
    const preview = await sync({}, { dryRun: true });
    expect(preview.data.changes).toContainEqual({ path: 'work/Trip ideas.md', oldPath: 'work/Trip planning.md', operation: 'renamed', revision: expect.any(String), bytes: expect.any(Number), diff: null });
    expect(preview.data.changes.find((change: { path: string }) => change.path === 'work/Draft a trip.md').diff).toContain('+parent: "[[Trip ideas]]"');
    const result = await sync();
    expect(result.data.changes).toContainEqual({ path: 'work/Trip ideas.md', oldPath: 'work/Trip planning.md', operation: 'renamed', revision: expect.any(String), bytes: expect.any(Number) });
    expect(await vault.read('work/Draft a trip.md')).toContain('parent: "[[Trip ideas]]"');
    expect(existsSync(join(vault.root, 'work/Trip planning.md'))).toBe(false);
    expect((await sync()).data.counts).toMatchObject({ updated: 0, pulled: 0, conflicts: 0, left: 0 });
  });

  it('keeps the type of a note whose remote type has no local mapping', async () => {
    vault = await backlogVault(planningNotes());
    await sync();
    const id = await ids();
    fake.edit('contoso', id('work/Draft a trip.md'), { 'System.WorkItemType': 'Risk' });
    const result = await sync();
    expect(skipsOf(result)).toEqual([{ path: 'work/Draft a trip.md', field: 'type', code: 'unmapped-remote-type' }]);
    expect(await vault.read('work/Draft a trip.md')).toContain('type: "PBI"');
  });

  it('syncs the area path both ways and leaves notes in the default area without one', async () => {
    vault = await backlogVault({ 'work/Sync.base': boundBase('work', 'Contoso', 'contoso'), 'work/Web.md': noteText({ type: 'Epic', order: 1, status: 'New', area: 'Trailhead\\Web' }), 'work/Core.md': noteText({ type: 'Epic', order: 2, status: 'New' }) });
    const run1 = await run(vault.root, connections({ areaPath: 'Trailhead\\Core' }), 'backlog', ['sync'], {}, { env });
    expect(run1.data.counts).toMatchObject({ created: 2, pulled: 0 });
    const id = await ids();
    expect(fake.item('contoso', id('work/Web.md')).fields['System.AreaPath']).toBe('Trailhead\\Web');
    expect(fake.item('contoso', id('work/Core.md')).fields['System.AreaPath']).toBe('Trailhead\\Core');
    expect(await vault.read('work/Core.md')).not.toContain('area');
    fake.edit('contoso', id('work/Core.md'), { 'System.AreaPath': 'Trailhead\\Mobile' });
    await vault.write('work/Web.md', (await vault.read('work/Web.md')).replace('area: "Trailhead\\\\Web"', 'area: "Trailhead\\\\Payments"'));
    const result = await run(vault.root, connections({ areaPath: 'Trailhead\\Core' }), 'backlog', ['sync'], {}, { env });
    expect(result.data.views[0].pulled).toEqual([expect.objectContaining({ path: 'work/Core.md', fields: ['area'] })]);
    expect(result.data.views[0].updated).toEqual([expect.objectContaining({ path: 'work/Web.md', fields: ['area'] })]);
    expect(await vault.read('work/Core.md')).toContain('area: Trailhead\\Mobile');
    expect(fake.item('contoso', id('work/Web.md')).fields['System.AreaPath']).toBe('Trailhead\\Payments');
  });
});

describe('views sharing a connection', () => {
  it('reports notes that left the sync set once per connection, across all of its views', async () => {
    const view = (name: string, folder: string) => `  - type: product-backlog\n    name: ${name}\n    filters:\n      and:\n        - file.inFolder("${folder}")\n    connection: contoso\n`;
    vault = await backlogVault({
      'Sync.base': `filters:\n  and:\n    - file.ext == "md"\nviews:\n${view('Plan', 'plan')}${view('Build', 'build')}`,
      'plan/Roadmap.md': noteText({ type: 'Epic', order: 1 }), 'build/Login.md': noteText({ type: 'Bug', order: 2 }),
    });
    const first = await sync();
    expect(first.data.counts).toMatchObject({ created: 2, left: 0 });
    expect((await sync({ view: 'Build' })).data.left).toEqual([]);
    const login = await vault.read('build/Login.md');
    await vault.write('archive/Login.md', login);
    await rm(join(vault.root, 'build/Login.md'));
    const result = await sync();
    expect(result.data.left).toEqual([expect.objectContaining({ connection: 'contoso', path: 'build/Login.md' })]);
    expect(result.events.filter(record => record.id === 'backlog.synced').map(record => (record.payload as { left: number }).left)).toEqual([1, 1]);
  });
});
