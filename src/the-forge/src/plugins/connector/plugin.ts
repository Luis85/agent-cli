import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { EventDefinition } from '../../application/plugins/events.ts';
import { isRecord } from '../../domain/shared/errors.ts';
import { Hub } from './application/hub.ts';
import { connectorSettings } from './domain/profiles.ts';
import { connectorsCommand } from './presentation/command.ts';
import { de, connectorStrings } from './presentation/strings.ts';

const payload = (value: unknown): value is Record<string, unknown> => isRecord(value)
  && ['connection', 'platform', 'path', 'remoteId', 'url'].every(key => typeof value[key] === 'string') && Array.isArray(value.fields);
const events: EventDefinition[] = [
  { id: 'connector.pushed', description: 'A note was pushed to its remote item: {connection, platform, path, remoteId, url, operation: create|update, fields}.', validate: payload },
  { id: 'connector.pulled', description: 'Remote changes were written into a note: {connection, platform, path, remoteId, url, fields}.', validate: payload },
  { id: 'connector.conflict', description: 'Fields changed on both sides since the last sync and were left untouched: {connection, platform, path, remoteId, url, fields}.', validate: payload },
];

/**
 * The `connector` core plugin: the shared backlog connector hub. It owns the connection profiles in
 * `plugins.settings.connector.connections`, the `connectors` command and the `connector.*` events, and provides the
 * `connector.hub` service with which platform connectors (`connector-azure-devops`) register and the backlog sync
 * engine resolves connections.
 */
export const connectorPlugin: CorePlugin = {
  manifest: {
    id: 'connector', name: 'Connectors', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Connection profiles and the shared hub for backlog connectors to external work trackers.',
  },
  strings: connectorStrings,
  create: host => {
    const hub = new Hub(host.environment);
    return {
      provides: { 'connector.hub': hub },
      onload(context) { hub.bind(context.settings, context.events); },
      commands: [connectorsCommand(hub, host.environment)],
      events,
      settings: connectorSettings,
      errors: [
        { code: 'CONNECTOR_NOT_FOUND', category: 'not-found', summary: 'The connection or its platform is not available.', hint: 'Check the connection id with connectors list and enable the platform\'s connector plugin.' },
        { code: 'CONNECTION_INVALID', category: 'input', summary: 'The connection profile is invalid.', hint: 'Fix the fields named in error.details.issues in plugins.settings.connector.connections.' },
        { code: 'CONNECTOR_AUTH_FAILED', category: 'external', summary: 'Authentication with the remote service failed.', hint: 'Set the environment variable named in error.details.tokenEnv to a valid access token with work item read and write scope.' },
        { code: 'CONNECTOR_REQUEST_FAILED', category: 'external', summary: 'A request to the remote service failed.', hint: 'Check error.details.status and the message, the organization URL and the project, then rerun the command.', retryable: true },
      ],
      strings: { de },
    };
  },
};
