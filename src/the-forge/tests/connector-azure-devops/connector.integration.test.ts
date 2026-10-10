import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '../../src/application/connectors/contract.ts';
import { FetchHttpClient } from '../../src/infrastructure/connectors/http-client.ts';
import { AzureDevOpsConnector } from '../../src/plugins/connector-azure-devops/application/connector.ts';
import { FakeAzureDevOps } from '../support/azure-devops.ts';

const PAT = 'connector-pat-0123456789';
let fake: FakeAzureDevOps;
const sleeps: number[] = [];
const connector = () => new AzureDevOpsConnector(new FetchHttpClient({ sleep: async milliseconds => { sleeps.push(milliseconds); } }));
const connection = (settings: Record<string, unknown> = {}, token = PAT): Connection => ({
  id: 'contoso', platform: 'azure-devops', tokenEnv: 'PAT', linkProperty: 'azure-devops', effortProperty: 'effort',
  settings: { organization: fake.organization('contoso'), project: 'Trailhead', process: 'agile', descriptionFormat: 'markdown', mappings: {}, ...settings },
  token: () => token,
});

beforeAll(async () => { fake = await new FakeAzureDevOps(PAT, { contoso: 'Trailhead' }).start(); });
afterAll(async () => { await fake.close(); });

describe('the Azure DevOps connector against the recorded API', () => {
  it('probes the project read-only and reports the process', async () => {
    const before = fake.writes().length;
    expect(await connector().test(connection())).toEqual({ ok: true, target: { organization: fake.organization('contoso'), project: 'Trailhead', projectId: 'contoso-Trailhead-id', state: 'wellFormed', process: 'Agile', processMatches: true } });
    expect(fake.writes().length).toBe(before);
    await expect(connector().test(connection({ project: 'Missing' }))).rejects.toMatchObject({ code: 'CONNECTOR_REQUEST_FAILED', details: { status: 404 } });
    await expect(connector().test(connection({}, 'bad-token-value'))).rejects.toMatchObject({ code: 'CONNECTOR_AUTH_FAILED', details: { status: 401, tokenEnv: 'PAT' } });
  });

  it('creates, reads by id and by change date, and links items to their web URL', async () => {
    const azure = connector();
    const parent = await azure.create(connection(), { type: 'Epic', title: 'Plan', tags: ['x'] });
    const child = await azure.create(connection({ areaPath: 'Trailhead\\Web' }), { type: 'User Story', title: 'Draft', parentId: parent.id, iteration: null, description: 'Text' });
    expect(child).toMatchObject({ parentId: parent.id, iteration: 'Trailhead', area: 'Trailhead\\Web', description: 'Text', url: `${fake.organization('contoso')}/Trailhead/_workitems/edit/${child.id}` });
    expect((await azure.query(connection(), { ids: [child.id, parent.id] })).map(item => item.title)).toEqual(['Draft', 'Plan']);
    const changed = String(fake.item('contoso', Number(parent.id)).fields['System.ChangedDate']);
    expect((await azure.query(connection({ areaPath: 'Trailhead\\Web' }), { changedSince: changed })).map(item => item.id)).toEqual([child.id]);
    expect(fake.requests.at(-2)!.path).toContain('/_apis/wit/wiql?timePrecision=true&api-version=7.1');
    expect(azure.idFromLink(connection(), child.url)).toBe(child.id);
    expect(azure.idFromLink(connection(), child.url.replace('contoso', 'fabrikam'))).toBeNull();
    expect(azure.idFromLink(connection(), 'https://example.com/x')).toBeNull();
  });

  it('guards updates with the revision and reports a stale one', async () => {
    const azure = connector();
    const item = await azure.create(connection(), { type: 'Task', title: 'Wire API', state: 'New' });
    const updated = await azure.update(connection(), item.id, { state: 'Active', tags: ['api'] }, item.rev);
    expect(updated).toMatchObject({ state: 'Active', tags: ['api'], rev: String(Number(item.rev) + 1) });
    await expect(azure.update(connection(), item.id, { state: 'Closed' }, item.rev)).rejects.toMatchObject({ code: 'CONNECTOR_REQUEST_FAILED', details: { status: 412, reason: 'stale-revision' } });
    const parent = await azure.create(connection(), { type: 'Feature', title: 'API' });
    expect((await azure.update(connection(), item.id, { parentId: parent.id }, updated.rev)).parentId).toBe(parent.id);
    expect((await azure.update(connection(), item.id, { parentId: null }, String(Number(updated.rev) + 1))).parentId).toBeNull();
  });

  it('retries throttled requests, honoring Retry-After', async () => {
    sleeps.length = 0;
    fake.throttleNext(2);
    expect((await connector().test(connection())).ok).toBe(true);
    expect(sleeps).toEqual([0, 0]);
  });

  it('keeps the token out of every error message and detail', async () => {
    const leaky = new AzureDevOpsConnector({ request: async () => { throw new Error(`connect failed with ${PAT}`); } });
    const failure = await leaky.test(connection()).catch(error => error);
    expect(failure).toMatchObject({ code: 'CONNECTOR_REQUEST_FAILED', message: 'connect failed with [redacted]' });
    const echo = new AzureDevOpsConnector({ request: async () => ({ status: 500, headers: {}, body: JSON.stringify({ message: `bad header Basic ${Buffer.from(`:${PAT}`).toString('base64')}` }) }) });
    expect(JSON.stringify(await echo.test(connection()).catch(error => ({ message: error.message, details: error.details })))).not.toMatch(new RegExp(`${PAT}|${Buffer.from(`:${PAT}`).toString('base64')}`));
  });
});
