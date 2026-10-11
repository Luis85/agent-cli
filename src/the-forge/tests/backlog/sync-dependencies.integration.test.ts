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
afterEach(async () => { fake.linksReviseTarget = false; fake.afterWrite = null; await vault?.dispose(); vault = undefined; });

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
    await run(vault.root, connections(), 'backlog', ['sync', 'resolve', 'Book flights'], { take: 'local' }, { env });
    expect(fake.predecessors('contoso', flights)).toEqual([]);
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
