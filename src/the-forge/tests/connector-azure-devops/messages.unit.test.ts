import { describe, expect, it } from 'vitest';
import type { Connection } from '../../src/application/connectors/contract.ts';
import { AzureDevOpsConnector } from '../../src/plugins/connector-azure-devops/application/connector.ts';
import { germanConnectorMessages } from '../../src/plugins/connector-azure-devops/presentation/strings.ts';

const http = { request: () => Promise.reject(new Error('This test makes no HTTP requests.')) };
const server: Connection = {
  id: 'server', platform: 'azure-devops', tokenEnv: 'ADO_PAT', linkProperty: 'azure-devops', effortProperty: 'effort', areaProperty: 'area',
  settings: { organization: 'https://tfs.example.com/DefaultCollection', project: 'Trailhead' }, token: () => 'unused',
};

describe('the Azure DevOps connector self-description', () => {
  it('describes itself and warns about an unexpected host in the requested language', () => {
    const connector = new AzureDevOpsConnector(http, { de: germanConnectorMessages });
    expect(connector.describe().warnings(server)).toEqual(['organization host tfs.example.com is neither dev.azure.com nor *.visualstudio.com, so requests are refused and the token in ADO_PAT is not sent; for Azure DevOps Server, list the host in the environment variable FORGE_CONNECTOR_ALLOWED_HOSTS.']);
    expect(connector.describe('de').warnings(server)).toEqual(['Der Organisations-Host tfs.example.com ist weder dev.azure.com noch *.visualstudio.com, daher werden Anfragen abgelehnt und das Token aus ADO_PAT wird nicht gesendet; tragen Sie den Host für Azure DevOps Server in die Umgebungsvariable FORGE_CONNECTOR_ALLOWED_HOSTS ein.']);
    expect(new AzureDevOpsConnector(http, {}, () => ['TFS.example.com']).describe().warnings(server)).toEqual([]);
    expect(connector.describe('de').description).toContain('Azure-DevOps-Projekts');
    expect(new AzureDevOpsConnector(http).describe('de').description).toBe(connector.describe('en').description);
  });
});
