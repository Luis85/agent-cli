import { describe, expect, it } from 'vitest';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';
import { redact } from '../../src/domain/connectors/secrets.ts';
import { FetchHttpClient, retryAfter } from '../../src/infrastructure/connectors/http-client.ts';
import { Hub } from '../../src/plugins/connector/application/hub.ts';
import { connectorSettings } from '../../src/plugins/connector/domain/profiles.ts';
import { AzureDevOpsConnector } from '../../src/plugins/connector-azure-devops/application/connector.ts';

const offline = { request: () => Promise.reject(new Error('offline')) };
const events = { emitted: [] as Array<[string, unknown]> };
function hub(connections: Record<string, unknown>, environment: Record<string, string> = {}) {
  const settings = validateJsonValue(connectorSettings, { connections }, 'plugins.settings.connector');
  const instance = new Hub(name => environment[name]);
  instance.bind(settings.value as Record<string, unknown>, { emit: async (id: string, payload: unknown) => { events.emitted.push([id, payload]); } } as never);
  instance.register(new AzureDevOpsConnector(offline));
  return { instance, issues: settings.issues };
}
const azure = (extra: Record<string, unknown> = {}) => ({ platform: 'azure-devops', organization: 'https://dev.azure.com/contoso', project: 'Trailhead', ...extra });

describe('connection profiles', () => {
  it('validates shared fields on load and platform fields on use, with platform defaults', () => {
    expect(hub({ a: { organization: 'x' } }).issues).toEqual(['plugins.settings.connector.connections.a.platform: is required']);
    expect(hub({ a: azure({ tokenEnv: 'not valid' }) }).issues).toEqual(['plugins.settings.connector.connections.a.tokenEnv: must match ^[A-Za-z_][A-Za-z0-9_]*$']);
    const { instance } = hub({ contoso: azure(), fabrikam: azure({ organization: 'https://dev.azure.com/fabrikam', process: 'scrum', tokenEnv: 'FABRIKAM_PAT', linkProperty: 'ado' }) });
    expect(instance.ids()).toEqual(['contoso', 'fabrikam']);
    expect(instance.connection('contoso').connection).toMatchObject({ tokenEnv: 'AZURE_DEVOPS_EXT_PAT', linkProperty: 'azure-devops', effortProperty: 'effort', settings: { process: 'agile', descriptionFormat: 'markdown' } });
    expect(instance.connection('fabrikam').connection).toMatchObject({ tokenEnv: 'FABRIKAM_PAT', linkProperty: 'ado', settings: { process: 'scrum' } });
  });

  it('names unknown connections, unavailable platforms and invalid profiles', () => {
    const { instance } = hub({
      plain: azure({ organization: 'http://dev.azure.com/contoso' }), typo: azure({ proces: 'agile' }), jira: { platform: 'jira' }, Upper: azure(),
      local: azure({ organization: 'http://127.0.0.1:8080/contoso' }), userinfo: azure({ organization: 'https://user:secret@dev.azure.com/contoso' }),
    });
    expect(() => instance.connection('missing')).toThrow(expect.objectContaining({ code: 'CONNECTOR_NOT_FOUND', details: { connection: 'missing', connections: ['plain', 'typo', 'jira', 'Upper', 'local', 'userinfo'] } }));
    expect(() => instance.connection('userinfo')).toThrow(expect.objectContaining({ code: 'CONNECTION_INVALID', details: { connection: 'userinfo', issues: [expect.stringContaining('organization: must match')] } }));
    expect(() => instance.connection('jira')).toThrow(expect.objectContaining({ code: 'CONNECTOR_NOT_FOUND', details: { connection: 'jira', platform: 'jira', platforms: ['azure-devops'] } }));
    expect(() => instance.connection('plain')).toThrow(expect.objectContaining({ code: 'CONNECTION_INVALID', details: { connection: 'plain', issues: [expect.stringContaining('organization: must match')] } }));
    expect(() => instance.connection('typo')).toThrow(expect.objectContaining({ code: 'CONNECTION_INVALID', details: { connection: 'typo', issues: ['plugins.settings.connector.connections.typo.proces: is not allowed'] } }));
    expect(() => instance.connection('Upper')).toThrow(expect.objectContaining({ code: 'CONNECTION_INVALID' }));
    expect(instance.connection('local').connection.id).toBe('local');
    expect(instance.statuses().map(status => [status.profile.id, status.issues.length === 0])).toEqual([['plain', false], ['typo', false], ['jira', false], ['Upper', false], ['local', true], ['userinfo', false]]);
  });

  it('warns when the organization is not an Azure DevOps Services host, since the token is sent there', () => {
    const { instance } = hub({ cloud: azure(), legacy: azure({ organization: 'https://contoso.visualstudio.com' }), server: azure({ organization: 'https://tfs.example.com/DefaultCollection' }) });
    const warnings = (id: string) => { const { connection, connector } = instance.connection(id); return connector.describe().warnings(connection); };
    expect(warnings('cloud')).toEqual([]);
    expect(warnings('legacy')).toEqual([]);
    expect(warnings('server')).toEqual([expect.stringContaining('organization host tfs.example.com is neither dev.azure.com nor *.visualstudio.com; the token in AZURE_DEVOPS_EXT_PAT is sent there')]);
    expect(instance.connection('cloud').connection.areaProperty).toBe('area');
  });

  it('reads the token only when a request needs it and reports a missing variable by name', async () => {
    const { instance } = hub({ contoso: azure() }, { AZURE_DEVOPS_EXT_PAT: ' secret-token ' });
    expect(instance.connection('contoso').connection.token()).toBe('secret-token');
    expect(JSON.stringify(instance.connection('contoso'))).not.toContain('secret-token');
    expect(() => hub({ contoso: azure() }).instance.connection('contoso').connection.token()).toThrow(expect.objectContaining({ code: 'CONNECTOR_AUTH_FAILED', details: { connection: 'contoso', tokenEnv: 'AZURE_DEVOPS_EXT_PAT' } }));
    await instance.report('conflict', { connection: 'contoso', platform: 'azure-devops', path: 'a.md', remoteId: '1', url: 'u', fields: ['title'] });
    expect(events.emitted.at(-1)).toEqual(['connector.conflict', expect.objectContaining({ path: 'a.md' })]);
  });

  it('refuses two connectors for one platform', () => {
    expect(() => hub({}).instance.register(new AzureDevOpsConnector(offline))).toThrow(expect.objectContaining({ code: 'CONNECTION_INVALID' }));
  });
});

describe('secrets and transport', () => {
  it('redacts a secret in plain, URL-encoded and Basic credential form', () => {
    const secret = 'abc/def+ghi';
    expect(redact(`x ${secret} ${encodeURIComponent(secret)} ${btoa(`:${secret}`)} y`, [secret])).toBe('x [redacted] [redacted] [redacted] y');
    expect(redact('short abc', ['abc'])).toBe('short abc');
  });

  it('reads Retry-After as seconds or an HTTP date', () => {
    expect(retryAfter('3')).toBe(3000);
    expect(retryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfter(null)).toBeNull();
    expect(retryAfter('soon')).toBeNull();
  });

  it('retries 429 and 503 with Retry-After or backoff, capped, and stops after the retry budget', async () => {
    const statuses = [429, 503, 503, 200];
    const waits: number[] = [];
    const fetch = async () => new Response('{}', { status: statuses.shift()!, headers: statuses.length === 3 ? { 'retry-after': '120' } : {} });
    const client = new FetchHttpClient({ fetch, sleep: async ms => { waits.push(ms); }, maxDelayMs: 5000 });
    expect((await client.request({ method: 'GET', url: 'https://x' })).status).toBe(200);
    expect(waits).toEqual([5000, 2000, 4000]);
    const always = new FetchHttpClient({ fetch: async () => new Response('', { status: 503 }), sleep: async () => {}, retries: 1 });
    expect((await always.request({ method: 'GET', url: 'https://x' })).status).toBe(503);
  });

  it('retries only requests that are safe to repeat: GET, or POST and PATCH marked retry-safe', async () => {
    let calls = 0;
    const throttled = new FetchHttpClient({ fetch: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '0' } }); }, sleep: async () => {}, retries: 2 });
    for (const method of ['POST', 'PATCH'] as const) {
      calls = 0;
      expect((await throttled.request({ method, url: 'https://x/create' })).status).toBe(429);
      expect(calls).toBe(1);
      calls = 0;
      await throttled.request({ method, url: 'https://x/read', retry: true });
      expect(calls).toBe(3);
    }
    calls = 0;
    await throttled.request({ method: 'GET', url: 'https://x', retry: false });
    expect(calls).toBe(1);
  });

  it('reports timeouts and connection failures by method and URL only', async () => {
    const timeout = new FetchHttpClient({ fetch: () => Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })), timeoutMs: 5 });
    await expect(timeout.request({ method: 'GET', url: 'https://x/a', headers: { Authorization: 'Basic secret' } })).rejects.toThrow('GET https://x/a timed out after 5 ms.');
    const refused = new FetchHttpClient({ fetch: () => Promise.reject(new TypeError('fetch failed')) });
    await expect(refused.request({ method: 'POST', url: 'https://x/b' })).rejects.toThrow('POST https://x/b could not connect.');
  });
});
