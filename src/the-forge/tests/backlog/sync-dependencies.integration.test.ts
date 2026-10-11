import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { backlogVault } from '../support/backlog.ts';
import { FakeAzureDevOps } from '../support/azure-devops.ts';
import { TOKEN_ENV, azureConnection, boundBase, noteText, run } from '../support/connectors.ts';

/** `dependsOn` lists ↔ Azure DevOps predecessor links (`System.LinkTypes.Dependency-Reverse`). */
const PAT = 'pat-dependencies-0123456789';
const env = { [TOKEN_ENV]: PAT };
const PREDECESSOR = 'System.LinkTypes.Dependency-Reverse';
let fake: FakeAzureDevOps;
let vault: Awaited<ReturnType<typeof backlogVault>> | undefined;
beforeAll(async () => { fake = await new FakeAzureDevOps(PAT, { contoso: 'Trailhead' }).start(); });
afterAll(async () => { await fake.close(); });
afterEach(async () => { fake.linksReviseTarget = false; fake.afterWrite = null; fake.beforeWrite = null; await vault?.dispose(); vault = undefined; });

const connections = () => ({ contoso: azureConnection(fake, 'contoso', 'Trailhead') });
const sync = (flags: Record<string, string | boolean> = {}, options: { dryRun?: boolean } = {}) => run(vault!.root, connections(), 'backlog', ['sync'], flags, { env, ...options });
const state = async () => JSON.parse(await vault!.read('.forge/sync/contoso.json')) as { items: Record<string, { id: string; rev: string }> };
const idOf = async (path: string) => Number((await state()).items[path]!.id);
const base = boundBase('plan', 'Plan', 'contoso').replace('    connection: contoso\n', '    dependsOnProperty: note.dependsOn\n    connection: contoso\n');
/** Book flights depends on Pick dates; Pack depends on both. Pack and Book flights rank before Pick dates, so they are created first. */
const notes = () => ({
  'plan/Plan.base': base,
  'plan/Pack.md': noteText({ type: 'PBI', order: 1000, dependsOn: ['[[Book flights]]', '[[Pick dates]]'] }),
  'plan/Book flights.md': noteText({ type: 'PBI', order: 2000, dependsOn: ['[[Pick dates]]'] }),
  'plan/Pick dates.md': noteText({ type: 'PBI', order: 3000 }),
});
/** Edits a note in place, as a person would in Obsidian. */
const replaceIn = async (path: string, from: string, to: string) => {
  const text = await vault!.read(path);
  expect(text).toContain(from);
  await vault!.write(path, text.replace(from, to));
};
const skips = (result: { data: Record<string, any> }) => result.data.views[0].skipped.map(({ path, field, code }: Record<string, string>) => ({ path, field, code }));

describe('pushing dependencies', () => {
  it('links predecessors created in the same run in any order, and records them so the next sync is a no-op', async () => {
    vault = await backlogVault(notes());
    const preview = await sync({}, { dryRun: true });
    expect(preview.data.views[0].created.map((entry: { path: string; fields: string[] }) => [entry.path, entry.fields.includes('dependencies')])).toEqual([['plan/Pack.md', true], ['plan/Book flights.md', true], ['plan/Pick dates.md', false]]);
    const result = await sync();
    expect(result.data.counts).toMatchObject({ created: 3, failed: 0 });
    expect(result.data.views[0].created.find((entry: { path: string }) => entry.path === 'plan/Pack.md').fields).toContain('dependencies');
    const [pack, flights, dates] = [await idOf('plan/Pack.md'), await idOf('plan/Book flights.md'), await idOf('plan/Pick dates.md')];
    expect(fake.predecessors('contoso', pack)).toEqual([flights, dates].sort((a, b) => a - b));
    expect(fake.predecessors('contoso', flights)).toEqual([dates]);
    // The service records the reverse (successor) link on the predecessor.
    expect(fake.item('contoso', dates).relations.filter(relation => relation.rel === 'System.LinkTypes.Dependency-Forward').length).toBe(2);
    const writes = fake.writes().length;
    const again = await sync();
    expect(again.data.counts).toMatchObject({ created: 0, updated: 0, pulled: 0, conflicts: 0 });
    expect(fake.writes().length).toBe(writes);
  });

  it('adds and removes links when the note changes its dependsOn list', async () => {
    vault = await backlogVault(notes());
    await sync();
    const [pack, flights, dates] = [await idOf('plan/Pack.md'), await idOf('plan/Book flights.md'), await idOf('plan/Pick dates.md')];
    await replaceIn('plan/Pack.md', '["[[Book flights]]","[[Pick dates]]"]', '["[[Pick dates]]"]');
    const result = await sync();
    expect(result.data.views[0].updated).toEqual([expect.objectContaining({ path: 'plan/Pack.md', fields: ['dependencies'] })]);
    expect(fake.predecessors('contoso', pack)).toEqual([dates]);
    expect(fake.predecessors('contoso', flights)).toEqual([dates]);
    expect((await sync()).data.counts).toMatchObject({ updated: 0, pulled: 0 });
  });

  it('tolerates links that revise the predecessor too, when that item gets its own links later in the same run', async () => {
    vault = await backlogVault({ ...notes(), 'plan/Renew passport.md': noteText({ type: 'PBI', order: 4000 }) });
    await sync();
    fake.linksReviseTarget = true;
    // Pack unlinks Pick dates first (Pack ranks first), which revises Pick dates before its own link update.
    await replaceIn('plan/Pack.md', '["[[Book flights]]","[[Pick dates]]"]', '["[[Book flights]]"]');
    await replaceIn('plan/Pick dates.md', 'status: New', 'status: Active\ndependsOn: ["[[Renew passport]]"]');
    const result = await sync();
    expect(result.data.counts).toMatchObject({ updated: 2, failed: 0, conflicts: 0 });
    const [dates, passport] = [await idOf('plan/Pick dates.md'), await idOf('plan/Renew passport.md')];
    expect(fake.item('contoso', dates).fields['System.State']).toBe('Active');
    expect(fake.predecessors('contoso', dates)).toEqual([passport]);
    expect((await sync()).data.counts).toMatchObject({ updated: 0, pulled: 0, failed: 0 });
  });
});

describe('pulling dependencies', () => {
  it('writes remote predecessor changes into dependsOn as backlog-view wikilinks and deletes an emptied list', async () => {
    vault = await backlogVault({ ...notes(), 'plan/Renew passport.md': noteText({ type: 'PBI', order: 4000 }) });
    await sync();
    const [pack, flights, dates, passport] = [await idOf('plan/Pack.md'), await idOf('plan/Book flights.md'), await idOf('plan/Pick dates.md'), await idOf('plan/Renew passport.md')];
    fake.unlink('contoso', pack, PREDECESSOR, flights);
    fake.link('contoso', dates, PREDECESSOR, passport);
    const result = await sync();
    expect(result.data.views[0].pulled.map((entry: { path: string; fields: string[] }) => [entry.path, entry.fields])).toEqual([['plan/Pack.md', ['dependencies']], ['plan/Pick dates.md', ['dependencies']]]);
    // The kept entry keeps its text; the list is written in Obsidian's block style.
    expect(await vault.read('plan/Pack.md')).toMatch(/\ndependsOn:\n  - "\[\[Pick dates\]\]"\n(?!  -)/);
    expect(await vault.read('plan/Pick dates.md')).toContain('dependsOn:\n  - "[[Renew passport]]"\n');
    fake.unlink('contoso', dates, PREDECESSOR, passport);
    await sync();
    expect(await vault.read('plan/Pick dates.md')).not.toContain('dependsOn');
    expect((await sync()).data.counts).toMatchObject({ updated: 0, pulled: 0 });
  });

  it('reports a change on both sides as a conflict and writes neither', async () => {
    vault = await backlogVault({ ...notes(), 'plan/Renew passport.md': noteText({ type: 'PBI', order: 4000 }) });
    await sync();
    const [flights, passport] = [await idOf('plan/Book flights.md'), await idOf('plan/Renew passport.md')];
    fake.link('contoso', flights, PREDECESSOR, passport);
    await replaceIn('plan/Book flights.md', 'dependsOn: ["[[Pick dates]]"]', 'dependsOn: []');
    const writes = fake.writes().length;
    const result = await sync();
    expect(result.data.views[0].conflicts).toEqual([expect.objectContaining({ path: 'plan/Book flights.md', fields: [{ field: 'dependencies', local: [], remote: [String(await idOf('plan/Pick dates.md')), String(passport)].sort((a, b) => Number(a) - Number(b)) }] })]);
    expect(fake.writes().length).toBe(writes);
    const resolved = await run(vault.root, connections(), 'backlog', ['sync', 'resolve', 'Book flights'], { take: 'local', field: 'dependencies' }, { env });
    expect(resolved.data.views[0].resolved).toEqual([{ path: 'plan/Book flights.md', take: 'local', fields: ['dependencies'] }]);
    expect(fake.predecessors('contoso', flights)).toEqual([]);
    expect((await sync()).data.counts).toMatchObject({ updated: 0, pulled: 0, conflicts: 0 });
  });

  it('pulls a predecessor or parent linked from the other item, although that keeps this item\'s revision', async () => {
    vault = await backlogVault({ 'plan/Plan.base': base, 'plan/Trip.md': noteText({ type: 'Epic', order: 500 }), 'plan/Book flights.md': noteText({ type: 'PBI', order: 1000 }), 'plan/Pick dates.md': noteText({ type: 'PBI', order: 2000 }) });
    await sync();
    const [trip, flights, dates] = [await idOf('plan/Trip.md'), await idOf('plan/Book flights.md'), await idOf('plan/Pick dates.md')];
    const rev = fake.item('contoso', flights).rev;
    // Pick dates gains Book flights as a successor and Trip gains it as a child: Book flights keeps its revision.
    fake.link('contoso', dates, 'System.LinkTypes.Dependency-Forward', flights);
    fake.link('contoso', trip, 'System.LinkTypes.Hierarchy-Forward', flights);
    expect(fake.item('contoso', flights).rev).toBe(rev);
    const result = await sync();
    expect(result.data.views[0].pulled).toEqual([expect.objectContaining({ path: 'plan/Book flights.md', fields: expect.arrayContaining(['parent', 'dependencies']) })]);
    const text = await vault.read('plan/Book flights.md');
    expect(text).toContain('parent: "[[Trip]]"');
    expect(text).toContain('dependsOn:\n  - "[[Pick dates]]"');
    expect((await sync()).data.counts).toMatchObject({ updated: 0, pulled: 0, conflicts: 0 });
  });

  it('skips a remote predecessor that is not synced, and a local dependency that cannot be expressed', async () => {
    vault = await backlogVault({ ...notes(), 'elsewhere/Outside.md': noteText({ type: 'PBI', order: 9000 }) });
    await sync();
    const [pack, flights] = [await idOf('plan/Pack.md'), await idOf('plan/Book flights.md')];
    const stranger = fake.add('contoso', { 'System.WorkItemType': 'User Story', 'System.Title': 'Only in Azure DevOps' });
    fake.link('contoso', flights, PREDECESSOR, stranger.id);
    fake.unlink('contoso', pack, PREDECESSOR, flights);
    await replaceIn('plan/Pack.md', '["[[Book flights]]","[[Pick dates]]"]', '["[[Outside]]"]');
    const writes = fake.writes().length;
    const result = await sync();
    expect(skips(result)).toEqual(expect.arrayContaining([
      { path: 'plan/Pack.md', field: 'dependencies', code: 'unexpressible' },
      { path: 'plan/Book flights.md', field: 'dependencies', code: 'unsynced-dependency' },
    ]));
    expect(fake.writes().length).toBe(writes);
    expect(await vault.read('plan/Book flights.md')).toContain('dependsOn: ["[[Pick dates]]"]\n');
  });
});

describe('links that did not land', () => {
  const refuseOnce = (operation: 'create' | 'update', matches: (operations: ReadonlyArray<{ op: string; path: string; value?: unknown }>) => boolean) => {
    let refused = false;
    fake.beforeWrite = (kind, operations) => {
      if (refused || kind !== operation || !matches(operations)) return;
      refused = true;
      return 'TF401320: Rule Error.';
    };
  };

  it('pushes the links of a created note on the next sync when a predecessor could not be created', async () => {
    vault = await backlogVault({ 'plan/Plan.base': base, 'plan/Book flights.md': noteText({ type: 'PBI', order: 1000, dependsOn: ['[[Pick dates]]'] }), 'plan/Pick dates.md': noteText({ type: 'PBI', order: 2000 }) });
    refuseOnce('create', operations => operations.some(operation => operation.path === '/fields/System.Title' && operation.value === 'Pick dates'));
    const first = await sync();
    expect(first.data.counts).toMatchObject({ created: 1, failed: 1 });
    expect(skips(first)).toContainEqual({ path: 'plan/Book flights.md', field: 'dependencies', code: 'unsynced-dependency' });
    const second = await sync();
    expect(second.data.counts).toMatchObject({ created: 1, updated: 1, conflicts: 0, failed: 0 });
    expect(fake.predecessors('contoso', await idOf('plan/Book flights.md'))).toEqual([await idOf('plan/Pick dates.md')]);
    expect((await sync()).data.counts).toMatchObject({ created: 0, updated: 0, pulled: 0, conflicts: 0 });
  });

  it('pushes the links of a created note again on the next sync when its link update failed', async () => {
    vault = await backlogVault(notes());
    refuseOnce('update', operations => operations.some(operation => operation.path === '/relations/-'));
    const first = await sync();
    expect(first.data.counts).toMatchObject({ created: 3, failed: 1 });
    const second = await sync();
    expect(second.data.counts).toMatchObject({ updated: 1, conflicts: 0, failed: 0 });
    const [pack, flights, dates] = [await idOf('plan/Pack.md'), await idOf('plan/Book flights.md'), await idOf('plan/Pick dates.md')];
    expect([fake.predecessors('contoso', pack), fake.predecessors('contoso', flights)]).toEqual([[flights, dates].sort((a, b) => a - b), [dates]]);
    expect((await sync()).data.counts).toMatchObject({ updated: 0, pulled: 0, conflicts: 0 });
  });

  it('never shows the placeholder of a note still to be created in a conflict', async () => {
    vault = await backlogVault({ 'plan/Plan.base': base, 'plan/Book flights.md': noteText({ type: 'PBI', order: 1000 }) });
    await sync();
    // The state is lost, so Book flights relinks by its link property while Pick dates is new.
    await vault.write('.forge/sync/contoso.json', JSON.stringify({ version: 1, connection: 'contoso', items: {} }));
    await vault.write('plan/Pick dates.md', noteText({ type: 'PBI', order: 2000 }));
    await replaceIn('plan/Book flights.md', 'type: "PBI"', 'type: "PBI"\ndependsOn: ["[[Pick dates]]"]');
    const preview = await sync({}, { dryRun: true });
    expect(preview.data.views[0].conflicts).toEqual([expect.objectContaining({ path: 'plan/Book flights.md', fields: [{ field: 'dependencies', local: ['plan/Pick dates.md'], remote: [] }] })]);
  });
});

describe('links changed concurrently on the other end', () => {
  it('reports a conflict instead of settling an update whose relation removal hit another link, and never pulls the lost parent', async () => {
    vault = await backlogVault({ 'plan/Plan.base': base, 'plan/Trip.md': noteText({ type: 'Epic', order: 500 }), 'plan/Pack.md': noteText({ type: 'PBI', order: 1000 }), 'plan/Book flights.md': noteText({ type: 'PBI', order: 2000 }) });
    await sync();
    const [trip, pack, flights] = [await idOf('plan/Trip.md'), await idOf('plan/Pack.md'), await idOf('plan/Book flights.md')];
    const stranger = fake.add('contoso', { 'System.WorkItemType': 'User Story', 'System.Title': 'Stranger' });
    fake.link('contoso', stranger.id, 'System.LinkTypes.Related', pack);
    // Pack's relations become [Related → stranger, Dependency-Reverse → Book flights, Hierarchy-Reverse → Trip].
    await replaceIn('plan/Pack.md', 'type: "PBI"', 'type: "PBI"\ndependsOn: ["[[Book flights]]"]');
    expect((await sync()).data.counts).toMatchObject({ updated: 1, failed: 0 });
    await replaceIn('plan/Pack.md', 'type: "PBI"', 'type: "PBI"\nparent: "[[Trip]]"');
    expect((await sync()).data.counts).toMatchObject({ updated: 1, failed: 0 });
    // The note drops its predecessor while the stranger's owner removes the Related link from the other end, without
    // a new revision of Pack: the removal by index then hits the parent link.
    await replaceIn('plan/Pack.md', 'dependsOn: ["[[Book flights]]"]\n', '');
    fake.beforeWrite = () => { fake.beforeWrite = null; fake.unlink('contoso', stranger.id, 'System.LinkTypes.Related', pack); };
    const raced = await sync();
    expect(raced.data.views[0].failed).toEqual([expect.objectContaining({ path: 'plan/Pack.md', code: 'SYNC_CONFLICT' })]);
    const next = await sync();
    expect(next.data.views[0].pulled).toEqual([]);
    expect(next.data.views[0].conflicts).toEqual([expect.objectContaining({ path: 'plan/Pack.md', fields: expect.arrayContaining([expect.objectContaining({ field: 'parent', local: String(trip), remote: null })]) })]);
    expect(await vault.read('plan/Pack.md')).toContain('parent: "[[Trip]]"');
    await run(vault.root, connections(), 'backlog', ['sync', 'resolve', 'Pack'], { take: 'local' }, { env });
    expect(fake.item('contoso', pack).relations.filter(relation => relation.rel === 'System.LinkTypes.Hierarchy-Reverse').map(relation => relation.url)).toEqual([expect.stringMatching(new RegExp(`/${trip}$`))]);
    expect(fake.predecessors('contoso', pack)).toEqual([]);
    void flights;
  });

  it('settles an update that only adds links although another link was removed from the other end meanwhile', async () => {
    vault = await backlogVault({ 'plan/Plan.base': base, 'plan/Pack.md': noteText({ type: 'PBI', order: 1000 }), 'plan/Book flights.md': noteText({ type: 'PBI', order: 2000 }) });
    await sync();
    const [pack, flights] = [await idOf('plan/Pack.md'), await idOf('plan/Book flights.md')];
    const stranger = fake.add('contoso', { 'System.WorkItemType': 'User Story', 'System.Title': 'Stranger' });
    fake.link('contoso', stranger.id, 'System.LinkTypes.Related', pack);
    await replaceIn('plan/Pack.md', 'type: "PBI"', 'type: "PBI"\ndependsOn: ["[[Book flights]]"]');
    fake.beforeWrite = () => { fake.beforeWrite = null; fake.unlink('contoso', stranger.id, 'System.LinkTypes.Related', pack); };
    const raced = await sync();
    expect(raced.data.counts).toMatchObject({ updated: 1, failed: 0 });
    expect(fake.predecessors('contoso', pack)).toEqual([flights]);
    expect((await sync()).data.counts).toMatchObject({ updated: 0, conflicts: 0, failed: 0 });
  });
});
