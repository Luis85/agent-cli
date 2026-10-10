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
  id: 'contoso', platform: 'azure-devops', tokenEnv: 'PAT', linkProperty: 'azure-devops', effortProperty: 'effort', areaProperty: 'area',
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

  it('creates, reads by id and links items to their web URL, with the default area for items without one', async () => {
    const azure = connector();
    const parent = await azure.create(connection(), { type: 'Epic', title: 'Plan', tags: ['x'] });
    const child = await azure.create(connection({ areaPath: 'Trailhead\\Web' }), { type: 'User Story', title: 'Draft', parentId: parent.id, iteration: null, area: null, description: 'Text' });
    expect(child).toMatchObject({ parentId: parent.id, iteration: 'Trailhead', area: null, description: 'Text', descriptionMarkdown: false, url: `${fake.organization('contoso')}/Trailhead/_workitems/edit/${child.id}` });
    expect(fake.item('contoso', Number(child.id)).fields['System.AreaPath']).toBe('Trailhead\\Web');
    expect(parent.area).toBeNull();
    expect((await azure.query(connection(), [child.id, parent.id, '999999'])).map(item => item.title)).toEqual(['Draft', 'Plan']);
    expect((await azure.update(connection(), child.id, { area: 'Trailhead\\Mobile' }, child.rev)).area).toBe('Trailhead\\Mobile');
    expect(azure.idFromLink(connection(), child.url)).toBe(child.id);
    expect(azure.idFromLink(connection(), child.url.replace('contoso', 'fabrikam'))).toBeNull();
    expect(azure.idFromLink(connection(), 'https://example.com/x')).toBeNull();
  });

  it('reads descriptions as raw text, Markdown only when the service declares the format', async () => {
    const azure = connector();
    const item = await azure.create(connection(), { type: 'Task', title: 'Notes', description: '**Plan**' });
    expect(fake.item('contoso', Number(item.id)).multilineFieldsFormat).toEqual({ 'System.Description': 'markdown' });
    expect((await azure.query(connection(), [item.id]))[0]).toMatchObject({ description: '**Plan**', descriptionMarkdown: false });
    fake.returnsFormats = true;
    try { expect((await azure.query(connection(), [item.id]))[0]).toMatchObject({ description: '**Plan**', descriptionMarkdown: true }); }
    finally { fake.returnsFormats = false; }
    const html = await azure.create(connection({ descriptionFormat: 'html' }), { type: 'Task', title: 'Html', description: '# Head' });
    expect(html).toMatchObject({ description: '<h1>Head</h1>', descriptionMarkdown: false });
  });

  it('creates items in the initial state and then moves them to the drafted state', async () => {
    const azure = connector();
    fake.initialStateOnly = true;
    try {
      const item = await azure.create(connection(), { type: 'User Story', title: 'Started', state: 'Active' });
      expect(item).toMatchObject({ state: 'Active', rev: '2' });
      const writes = fake.writes().slice(-2);
      expect(writes.map(write => write.method)).toEqual(['POST', 'PATCH']);
      expect(JSON.stringify(writes[0]!.body)).not.toContain('System.State');
      const fresh = await azure.create(connection(), { type: 'User Story', title: 'Fresh', state: 'New' });
      expect(fresh.rev).toBe('1');
      // A follow-up the service refuses still returns the created item, so its id is never lost.
      const refusing = new AzureDevOpsConnector({
        request: async request => {
          const response = await new FetchHttpClient().request(request);
          return request.method === 'PATCH' ? { status: 400, headers: {}, body: JSON.stringify({ message: 'TF401320: Rule Error for field State.' }) } : response;
        },
      });
      expect(await refusing.create(connection(), { type: 'User Story', title: 'Stays new', state: 'Resolved' })).toMatchObject({ title: 'Stays new', state: 'New' });
    } finally { fake.initialStateOnly = false; }
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
