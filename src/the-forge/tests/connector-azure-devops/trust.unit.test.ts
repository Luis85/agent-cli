import { describe, expect, it } from 'vitest';
import type { Connection } from '../../src/application/connectors/contract.ts';
import type { HttpClient, HttpRequest } from '../../src/application/connectors/http.ts';
import { AzureDevOpsConnector } from '../../src/plugins/connector-azure-devops/application/connector.ts';
import { Hub } from '../../src/plugins/connector/application/hub.ts';
import { connectorSettings } from '../../src/plugins/connector/domain/profiles.ts';
import { connectorsCommand } from '../../src/plugins/connector/presentation/command.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';

/** A fake transport that records every request and answers with a project. */
function recordingHttp() {
  const requests: HttpRequest[] = [];
  const http: HttpClient = { request: async request => { requests.push(request); return { status: 200, headers: {}, body: JSON.stringify({ id: 'p', name: 'Trailhead', state: 'wellFormed' }) }; } };
  return { http, requests };
}
const connection = (organization: string, project = 'Trailhead'): Connection => ({
  id: 'remote', platform: 'azure-devops', tokenEnv: 'ADO_PAT', linkProperty: 'azure-devops', effortProperty: 'effort', areaProperty: 'area',
  settings: { organization, project, process: 'agile', descriptionFormat: 'markdown', mappings: {} }, token: () => 'secret-token',
});

describe('trusted Azure DevOps hosts', () => {
  it.each(['https://evil.example', 'https://tfs.example.com/DefaultCollection', 'https://dev.azure.com.evil.example/x'])('sends no request and no token to the untrusted host of %s', async organization => {
    const { http, requests } = recordingHttp();
    const host = new URL(organization).hostname;
    await expect(new AzureDevOpsConnector(http).test(connection(organization))).rejects.toMatchObject({
      code: 'CONNECTION_INVALID', details: { connection: 'remote', host, issues: [expect.stringContaining('FORGE_CONNECTOR_ALLOWED_HOSTS')] },
    });
    await expect(new AzureDevOpsConnector(http).query(connection(organization), ['1'])).rejects.toMatchObject({ code: 'CONNECTION_INVALID' });
    expect(requests).toEqual([]);
  });

  it('sends requests to Azure DevOps Services, loopback and hosts the user allow-listed', async () => {
    const { http, requests } = recordingHttp();
    for (const organization of ['https://dev.azure.com/contoso', 'https://contoso.visualstudio.com', 'http://127.0.0.1:8080/contoso']) {
      expect(await new AzureDevOpsConnector(http).test(connection(organization))).toMatchObject({ ok: true });
    }
    expect(await new AzureDevOpsConnector(http, {}, () => ['TFS.example.com']).test(connection('https://tfs.example.com/DefaultCollection'))).toMatchObject({ ok: true });
    expect(requests.map(request => new URL(request.url).host)).toEqual(['dev.azure.com', 'contoso.visualstudio.com', '127.0.0.1:8080', 'tfs.example.com']);
  });

  it('refuses `connectors test` for a profile from shared configuration that names an unlisted host', async () => {
    const { http, requests } = recordingHttp();
    const environment = (name: string) => ({ ADO_PAT: 'secret-token' } as Record<string, string>)[name];
    const settings = validateJsonValue(connectorSettings, { connections: { evil: { platform: 'azure-devops', organization: 'https://evil.example', project: 'x', tokenEnv: 'ADO_PAT' } } }, 'plugins.settings.connector');
    const hub = new Hub(environment);
    hub.bind(settings.value as Record<string, unknown>, { emit: async () => {} } as never);
    hub.register(new AzureDevOpsConnector(http));
    const command = connectorsCommand(hub, environment);
    await expect(command.run(['test', 'evil'], {}, { language: 'en' } as never)).rejects.toMatchObject({ code: 'CONNECTION_INVALID', details: { host: 'evil.example' } });
    expect(requests).toEqual([]);
    const listed = await command.run(['list'], {}, { language: 'en' } as never) as { connections: Array<{ warnings: string[] }> };
    expect(listed.connections[0]!.warnings).toEqual([expect.stringContaining('requests are refused')]);
  });
});

describe('work item links', () => {
  it.each([
    ['https://dev.azure.com/contoso', 'Trailhead'],
    ['https://dev.azure.com/contoso', 'Trail Head'],
    ['https://tfs.example.com/tfs/Default%20Collection', 'Trailhead'],
    ['https://tfs.example.com/tfs/Default%20Collection', 'Trail Head (EU)'],
    ['https://tfs.example.com/tfs/Default Collection/', 'Trail%Head'],
  ])('reads back the id of its own link for %s with project %s', (organization, project) => {
    const connector = new AzureDevOpsConnector(recordingHttp().http), bound = connection(organization, project);
    expect(connector.idFromLink(bound, connector.link(bound, '42'))).toBe('42');
    expect(connector.idFromLink(bound, connector.link(connection(organization, `${project}-other`), '42'))).toBeNull();
  });
});
