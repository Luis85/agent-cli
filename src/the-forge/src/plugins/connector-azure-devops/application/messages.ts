/** English texts of the connector's self-description; a translation with the same keys renders it in another language. */
export const connectorMessages = {
  description: 'Work items of one Azure DevOps project through the Work Items REST API 7.1.',
  unknownHost: 'organization host {host} is neither dev.azure.com nor *.visualstudio.com, so requests are refused and the token in {tokenEnv} is not sent; for Azure DevOps Server, list the host in the environment variable {variable}.',
} as const satisfies Record<string, string>;

export type ConnectorMessages = Record<keyof typeof connectorMessages, string>;
