import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

/** The Azure DevOps connector's German manifest; it contributes no command, and its warnings come from its domain. */
export const azureDevOpsStrings: PluginStrings = {
  de: {
    manifest: { name: 'Azure-DevOps-Boards-Connector', description: 'Backlog-Einträge über die REST-API für Work Items mit Work Items in Azure DevOps Boards abgleichen.' },
  },
};
