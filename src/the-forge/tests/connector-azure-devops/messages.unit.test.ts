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
    expect(connector.describe().warnings(server)).toEqual(['organization host tfs.example.com is neither dev.azure.com nor *.visualstudio.com; the token in ADO_PAT is sent there (expected only for Azure DevOps Server).']);
    expect(connector.describe('de').warnings(server)).toEqual(['Der Organisations-Host tfs.example.com ist weder dev.azure.com noch *.visualstudio.com; das Token aus ADO_PAT wird dorthin gesendet (nur für Azure DevOps Server zu erwarten).']);
    expect(connector.describe('de').description).toContain('Azure-DevOps-Projekts');
    expect(new AzureDevOpsConnector(http).describe('de').description).toBe(connector.describe('en').description);
  });
});
