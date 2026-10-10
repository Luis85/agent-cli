import type { ConnectorHub } from '../../application/connectors/contract.ts';
import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import { AzureDevOpsConnector } from './application/connector.ts';

/**
 * The `connector-azure-devops` core plugin: Azure DevOps Boards for the backlog sync engine. It provides the
 * `connector-azure-devops.connector` service and registers it with the `connector.hub` service when it loads; connection profiles
 * with `platform: azure-devops` then reach it. Disabling it leaves those connections unavailable.
 */
export const azureDevOpsPlugin: CorePlugin = {
  manifest: {
    id: 'connector-azure-devops', name: 'Azure DevOps Boards connector', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Sync backlog items with Azure DevOps Boards work items through the Work Items REST API.',
  },
  create: host => {
    const connector = new AzureDevOpsConnector(host.http);
    return {
      provides: { 'connector-azure-devops.connector': connector },
      requires: ['connector.hub'],
      onload(context) { context.services.get<ConnectorHub>('connector.hub').register(connector); },
    };
  },
};
