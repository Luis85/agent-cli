import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { FakeAzureDevOps } from '../support/azure-devops.ts';

const PAT = 'e2e-personal-access-token-42';
const fixture = portableCli();
const read = (path: string) => readFile(join(fixture.project, path), 'utf8');
let fake: FakeAzureDevOps;

beforeAll(async () => {
  fake = await new FakeAzureDevOps(PAT, { contoso: 'Trailhead' }).start();
  const connections = { contoso: { platform: 'azure-devops', organization: fake.organization('contoso'), project: 'Trailhead', iterationRoot: 'Trailhead', tokenEnv: 'FORGE_E2E_PAT' } };
  await mkdir(join(fixture.project, 'bin'), { recursive: true });
  await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify({ plugins: { settings: { connector: { connections } } } }));
});
afterAll(async () => { await fake.close(); });

const base = 'filters:\n  and:\n    - file.inFolder("plan")\nviews:\n  - type: product-backlog\n    name: Backlog\n    homeFolder: plan\n    stateProperty: note.status\n    stateValues: Open, Active, Done\n    connection: contoso\n';

describe('syncing a backlog with Azure DevOps through the portable CLI', () => {
  it('tests the connection, previews, pushes, pulls and keeps the state through renames without exposing the token', async () => {
    const outputs: string[] = [];
    const cli = async (args: string[], token: string | null = PAT, status = 0) => {
      const result = await fixture.cliAsync(args, token === null ? {} : { FORGE_E2E_PAT: token });
      outputs.push(result.stdout);
      expect(result.status, result.stdout).toBe(status);
      return result.body;
    };
    const init = await cli(['backlog', 'init', '--folder', 'plan']);
    await cli(['write', 'plan/Product Backlog.base', '--content', base, '--if-match', init.data.changes[0].revision]);
    await cli(['backlog', 'add', 'Epic', 'Trip planning', '--state', 'Active']);
    await cli(['backlog', 'add', 'PBI', 'Draft a trip', '--parent', 'Trip planning', '--state', 'Open']);

    expect((await cli(['connectors', 'list'])).data.connections).toEqual([expect.objectContaining({ id: 'contoso', platform: 'azure-devops', valid: true, tokenSet: true, tokenEnv: 'FORGE_E2E_PAT', process: 'agile' })]);
    expect((await cli(['connectors', 'test', 'contoso'])).data).toMatchObject({ ok: true, target: { project: 'Trailhead', process: 'Agile' } });
    expect((await cli(['connectors', 'test', 'contoso'], null, 1)).error).toMatchObject({ code: 'CONNECTOR_AUTH_FAILED', details: { tokenEnv: 'FORGE_E2E_PAT' } });

    const preview = await cli(['backlog', 'sync', '--dry-run']);
    expect(preview.data).toMatchObject({ dryRun: true, counts: { created: 2 } });
    expect(fake.writes()).toEqual([]);

    const pushed = await cli(['backlog', 'sync']);
    expect(pushed.data.counts).toMatchObject({ created: 2, failed: 0 });
    expect(pushed.events.map((record: { id: string }) => record.id)).toEqual(expect.arrayContaining(['vault.modify', 'vault.create']));
    const [epic, story] = fake.list('contoso');
    expect(story!.relations[0]!.url).toMatch(new RegExp(`/workItems/${epic!.id}$`));
    expect(await read('plan/requirements/Draft a trip.md')).toContain(`azure-devops: ${fake.organization('contoso')}/Trailhead/_workitems/edit/${story!.id}`);

    fake.edit('contoso', story!.id, { 'System.State': 'Closed' });
    expect((await cli(['backlog', 'sync', 'status'])).data.views[0].pulled).toEqual([expect.objectContaining({ path: 'plan/requirements/Draft a trip.md', fields: ['state'] })]);
    await cli(['backlog', 'sync', '--direction', 'pull']);
    expect(await read('plan/requirements/Draft a trip.md')).toContain('status: Done');

    const revision = (await cli(['read', 'plan/requirements/Draft a trip.md'])).data.revision;
    await cli(['move', 'plan/requirements/Draft a trip.md', 'plan/requirements/Draft trips.md', '--if-match', revision]);
    expect(Object.keys(JSON.parse(await read('.forge/sync/contoso.json')).items)).toEqual(['plan/requirements/Draft trips.md', 'plan/requirements/Trip planning.md']);
    expect((await cli(['backlog', 'sync'])).data.views[0].updated).toEqual([expect.objectContaining({ path: 'plan/requirements/Draft trips.md', fields: ['title'] })]);
    expect(fake.item('contoso', story!.id).fields['System.Title']).toBe('Draft trips');

    for (const output of outputs) {
      expect(output).not.toContain(PAT);
      expect(output).not.toContain(Buffer.from(`:${PAT}`).toString('base64'));
    }
  }, 60_000);
});
