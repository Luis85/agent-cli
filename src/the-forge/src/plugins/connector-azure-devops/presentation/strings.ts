import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';
import type { ConnectorMessages } from '../application/messages.ts';

/** The Azure DevOps connector's German manifest; it contributes no command or option. */
export const azureDevOpsStrings: PluginStrings = {
  de: {
    manifest: { name: 'Azure-DevOps-Boards-Connector', description: 'Backlog-Einträge über die REST-API für Work Items mit Work Items in Azure DevOps Boards abgleichen.' },
  },
};

/** The German self-description that `connectors list` and `connectors inspect` show. */
export const germanConnectorMessages: ConnectorMessages = {
  description: 'Work Items eines Azure-DevOps-Projekts über die REST-API 7.1 für Work Items.',
  unknownHost: 'Der Organisations-Host {host} ist weder dev.azure.com noch *.visualstudio.com, daher werden Anfragen abgelehnt und das Token aus {tokenEnv} wird nicht gesendet; tragen Sie den Host für Azure DevOps Server in die Umgebungsvariable {variable} ein.',
};
