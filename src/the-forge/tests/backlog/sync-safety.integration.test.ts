import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { backlogVault } from '../support/backlog.ts';
import { FakeAzureDevOps } from '../support/azure-devops.ts';
import { TOKEN_ENV, azureConnection, noteText, planningNotes, run } from '../support/connectors.ts';

/** Sync must never lose data or create duplicates: when in doubt it reports a conflict or a skip instead of writing. */
const PAT = 'pat-safety-0123456789';
const env = { [TOKEN_ENV]: PAT };
let fake: FakeAzureDevOps;
let vault: Awaited<ReturnType<typeof backlogVault>> | undefined;
beforeAll(async () => { fake = await new FakeAzureDevOps(PAT, { contoso: 'Trailhead' }).start(); });
afterAll(async () => { await fake.close(); });
afterEach(async () => { fake.afterWrite = null; fake.returnsFormats = false; fake.pat = PAT; await vault?.dispose(); vault = undefined; });

const connections = () => ({ contoso: azureConnection(fake, 'contoso', 'Trailhead') });
const sync = (flags: Record<string, string | boolean> = {}, options: { dryRun?: boolean } = {}) => run(vault!.root, connections(), 'backlog', ['sync'], flags, { env, ...options });
const state = async () => JSON.parse(await vault!.read('.forge/sync/contoso.json')) as { items: Record<string, { id: string; rev: string; fields: Record<string, string> }> };
const DESCRIPTION = 'System.Description';
const skipsOf = (result: { data: Record<string, any> }) => result.data.views[0].skipped.map(({ path, field, code }: Record<string, string>) => ({ path, field, code }));

async function linked() {
  vault = await backlogVault(planningNotes());
  await sync();
  const entries = (await state()).items;
  return (path: string) => Number(entries[path]!.id);
}

describe('relinking without a sync base', () => {
  it('reports differing fields as conflicts and never pushes the note over the remote', async () => {
    const id = await linked();
    fake.edit('contoso', id('work/Draft a trip.md'), { [DESCRIPTION]: '<p>Written in the <b>HTML</b> editor</p>', 'Microsoft.VSTS.Common.Priority': 3 });
    await rm(join(vault!.root, '.forge/sync/contoso.json'));
    const writes = fake.writes().length;
    const result = await sync();
    expect(result.data.views[0].conflicts).toEqual([expect.objectContaining({ path: 'work/Draft a trip.md', fields: [
      { field: 'priority', local: 1, remote: 3 },
      { field: 'description', local: 'Plan the **stops**.', remote: '<p>Written in the <b>HTML</b> editor</p>' },
    ] })]);
    expect(fake.writes().length).toBe(writes);
    expect(fake.item('contoso', id('work/Draft a trip.md')).fields[DESCRIPTION]).toBe('<p>Written in the <b>HTML</b> editor</p>');
    expect(result.data.counts).toMatchObject({ created: 0, updated: 0, conflicts: 1 });
    expect(Object.keys((await state()).items)).toHaveLength(3);
  });

  it('skips a field the remote cannot read instead of pushing over it, and never pushes a null', async () => {
    vault = await backlogVault(planningNotes());
    const connection = { contoso: azureConnection(fake, 'contoso', 'Trailhead', { mappings: { properties: { risk: 'Custom.Risk' } } }) };
    await vault.write('work/Draft a trip.md', noteText({ type: 'PBI', order: 3000, risk: 'high' }));
    await run(vault.root, connection, 'backlog', ['sync'], {}, { env });
    const draft = Number((await state()).items['work/Draft a trip.md']!.id);
    fake.edit('contoso', draft, { 'Custom.Risk': { structured: true } });
    await rm(join(vault.root, '.forge/sync/contoso.json'));
    await vault.write('work/Draft a trip.md', (await vault.read('work/Draft a trip.md')).replace('risk: "high"', 'risk: null'));
    const writes = fake.writes().length;
    const result = await run(vault.root, connection, 'backlog', ['sync'], {}, { env });
    expect(skipsOf(result)).toContainEqual({ path: 'work/Draft a trip.md', field: 'property:risk', code: 'unreadable-remote' });
    expect(fake.writes().length).toBe(writes);
    expect(fake.item('contoso', draft).fields['Custom.Risk']).toEqual({ structured: true });
  });
});

describe('descriptions without a declared format', () => {
  it('pushes over the text it last synced, holds remote edits it cannot read as Markdown, and pulls declared Markdown', async () => {
    const id = await linked();
    const draft = id('work/Draft a trip.md');
    expect((await state()).items['work/Draft a trip.md']!.fields['remote:description']).toMatch(/^[0-9a-f]{16}$/);
    await vault!.write('work/Draft a trip.md', (await vault!.read('work/Draft a trip.md')).replace('Plan the **stops**.', 'Plan the **stops** and %%private%% the nights.'));
    expect((await sync()).data.views[0].updated).toEqual([expect.objectContaining({ fields: ['description'] })]);
    expect(fake.item('contoso', draft).fields[DESCRIPTION]).toBe('Plan the **stops** and  the nights.');
    fake.edit('contoso', draft, { [DESCRIPTION]: '<div>Someone used the HTML editor</div>' });
    const held = await sync();
    expect(skipsOf(held)).toEqual([{ path: 'work/Draft a trip.md', field: 'description', code: 'remote-format-unknown' }]);
    expect(await vault!.read('work/Draft a trip.md')).toContain('%%private%%');
    expect(fake.item('contoso', draft).fields[DESCRIPTION]).toBe('<div>Someone used the HTML editor</div>');
    await vault!.write('work/Draft a trip.md', (await vault!.read('work/Draft a trip.md')).replace('the nights', 'the days'));
    expect((await sync()).data.views[0].conflicts).toEqual([expect.objectContaining({ fields: [expect.objectContaining({ field: 'description' })] })]);
    await run(vault!.root, connections(), 'backlog', ['sync', 'resolve', 'Draft a trip'], { take: 'local', field: 'description' }, { env });
    expect(fake.item('contoso', draft).fields[DESCRIPTION]).toBe('Plan the **stops** and  the days.');
    fake.returnsFormats = true;
    fake.edit('contoso', draft, { [DESCRIPTION]: 'Plan the **stops** first.' });
    expect((await sync()).data.views[0].pulled).toEqual([expect.objectContaining({ fields: ['description'] })]);
    expect(await vault!.read('work/Draft a trip.md')).toMatch(/\n---\nPlan the \*\*stops\*\* first\.\n\n%%private%%\n$/);
    expect((await sync()).data.counts).toMatchObject({ updated: 0, pulled: 0, conflicts: 0 });
  });
});

describe('failures part-way through a sync', () => {
  it('records each created item at once, stops at a refused token, and creates nothing twice on retry', async () => {
    vault = await backlogVault(planningNotes());
    const before = fake.list('contoso').length, creates = () => fake.writes().filter(write => write.method === 'POST').length;
    const attempts = creates();
    fake.afterWrite = (_item, operation) => { if (operation === 'create') fake.pat = 'revoked-token-value'; };
    await expect(sync()).rejects.toMatchObject({ code: 'CONNECTOR_AUTH_FAILED' });
    const requests = fake.requests.length;
    expect(fake.list('contoso').length).toBe(before + 1);
    // The refused second create was the last attempt: the third note was never sent.
    expect(creates() - attempts).toBe(2);
    expect(Object.keys((await state()).items)).toEqual(['work/Trip planning.md']);
    fake.afterWrite = null;
    fake.pat = PAT;
    const retry = await sync();
    expect(fake.requests.length).toBeGreaterThan(requests);
    expect(retry.data.counts).toMatchObject({ created: 2, failed: 0 });
    expect(fake.list('contoso').length).toBe(before + 3);
    expect(await vault.read('work/Trip planning.md')).toContain(`azure-devops: ${fake.organization('contoso')}/Trailhead/_workitems/edit/`);
    expect((await sync()).data.counts).toMatchObject({ created: 0, updated: 0 });
  });

  it('keeps a concurrent change to the state file and its own created items', async () => {
    vault = await backlogVault(planningNotes());
    const before = fake.list('contoso').length;
    const foreign = { id: '9999', url: 'https://example.invalid/9999', rev: '1', fields: {} };
    let creates = 0;
    fake.afterWrite = async (_item, operation) => {
      if (operation !== 'create' || ++creates !== 2) return;
      const current = await state();
      await vault!.write('.forge/sync/contoso.json', JSON.stringify({ version: 1, connection: 'contoso', items: { ...current.items, 'elsewhere/Moved.md': foreign } }));
    };
    const result = await sync();
    expect(result.data.counts).toMatchObject({ created: 3, failed: 0, left: 1 });
    expect(result.data.left).toEqual([{ connection: 'contoso', path: 'elsewhere/Moved.md', remoteId: '9999', url: foreign.url }]);
    expect(Object.keys((await state()).items).sort()).toEqual(['elsewhere/Moved.md', 'work/Draft a trip.md', 'work/Itinerary builder.md', 'work/Trip planning.md']);
    fake.afterWrite = null;
    expect((await sync()).data.counts).toMatchObject({ created: 0 });
    expect(fake.list('contoso').length).toBe(before + 3);
  });

  it('refuses a second sync of the same connection while one runs', async () => {
    vault = await backlogVault(planningNotes());
    let concurrent: unknown;
    fake.afterWrite = async (_item, operation) => {
      if (operation !== 'create' || concurrent !== undefined) return;
      concurrent = await sync().catch(error => error);
    };
    expect((await sync()).data.counts.created).toBe(3);
    expect(concurrent).toMatchObject({ code: 'WORKSPACE_BUSY', message: expect.stringContaining('Lock .forge/sync/contoso.lock exists'), details: { lock: expect.objectContaining({ command: 'backlog sync' }) } });
    expect(existsSync(join(vault.root, '.forge/sync/contoso.lock'))).toBe(false);
  });
});

describe('copied notes', () => {
  it('never lets a copy take over the remote item of its original', async () => {
    const id = await linked();
    const original = await vault!.read('work/Draft a trip.md');
    await vault!.write('work/A copy of the draft.md', original.replace('order: 3000', 'order: 500'));
    const writes = fake.writes().length;
    const result = await sync();
    expect(skipsOf(result)).toContainEqual({ path: 'work/A copy of the draft.md', code: 'duplicate-link' });
    expect(fake.writes().length).toBe(writes);
    expect(fake.item('contoso', id('work/Draft a trip.md')).fields['System.Title']).toBe('Draft a trip');
    expect(Object.keys((await state()).items)).not.toContain('work/A copy of the draft.md');
    await rm(join(vault!.root, '.forge/sync/contoso.json'));
    // Without a state file nothing tells the original from the copy: neither claims the item until one link is removed.
    const relinked = await sync();
    expect(relinked.data.views[0].skipped.filter((skip: { code: string }) => skip.code === 'duplicate-link').map((skip: { path: string }) => skip.path)).toEqual(['work/A copy of the draft.md', 'work/Draft a trip.md']);
    expect(fake.writes().length).toBe(writes);
    expect(Object.keys((await state()).items).sort()).toEqual(['work/Itinerary builder.md', 'work/Trip planning.md']);
  });
});
