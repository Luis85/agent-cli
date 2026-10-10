import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { EventDefinition } from '../../application/plugins/events.ts';
import { isRecord } from '../../domain/shared/errors.ts';
import { Hub } from './application/hub.ts';
import { connectorSettings } from './domain/profiles.ts';
import { connectorsCommand } from './presentation/command.ts';

const payload = (value: unknown): value is Record<string, unknown> => isRecord(value)
  && ['connection', 'platform', 'path', 'remoteId', 'url'].every(key => typeof value[key] === 'string') && Array.isArray(value.fields);
const events: EventDefinition[] = [
  { id: 'connector.pushed', description: 'A note was pushed to its remote item: {connection, platform, path, remoteId, url, operation: create|update, fields}.', validate: payload },
  { id: 'connector.pulled', description: 'Remote changes were written into a note: {connection, platform, path, remoteId, url, fields}.', validate: payload },
  { id: 'connector.conflict', description: 'Fields changed on both sides since the last sync and were left untouched: {connection, platform, path, remoteId, url, fields}.', validate: payload },
];

const de = {
  commands: { connectors: 'Die in plugins.settings.connector.connections konfigurierten Backlog-Verbindungen auflisten, prüfen und testen.' },
  events: {
    'connector.pushed': 'Eine Notiz wurde in ihr entferntes Work Item übertragen.',
    'connector.pulled': 'Entfernte Änderungen wurden in eine Notiz geschrieben.',
    'connector.conflict': 'Felder wurden seit dem letzten Abgleich auf beiden Seiten geändert und blieben unverändert.',
  },
  errors: {
    CONNECTOR_NOT_FOUND: { summary: 'Die Verbindung oder ihre Plattform ist nicht verfügbar.', hint: 'Prüfen Sie die Verbindungs-ID mit connectors list und aktivieren Sie das Connector-Plugin der Plattform.' },
    CONNECTION_INVALID: { summary: 'Das Verbindungsprofil ist ungültig.', hint: 'Korrigieren Sie die in error.details.issues genannten Felder in plugins.settings.connector.connections.' },
    CONNECTOR_AUTH_FAILED: { summary: 'Die Anmeldung beim entfernten Dienst ist fehlgeschlagen.', hint: 'Setzen Sie die in error.details.tokenEnv genannte Umgebungsvariable auf ein gültiges Zugriffstoken mit Lese- und Schreibrechten für Work Items.' },
    CONNECTOR_REQUEST_FAILED: { summary: 'Eine Anfrage an den entfernten Dienst ist fehlgeschlagen.', hint: 'Prüfen Sie error.details.status und die Meldung, die Organisations-URL und das Projekt, und wiederholen Sie den Befehl.' },
  },
};

/**
 * The `connector` core plugin: the shared backlog connector hub. It owns the connection profiles in
 * `plugins.settings.connector.connections`, the `connectors` command and the `connector.*` events, and provides the
 * `connectors` service with which platform connectors (`connector-azure-devops`) register and the backlog sync
 * engine resolves connections.
 */
export const connectorPlugin: CorePlugin = {
  manifest: {
    id: 'connector', name: 'Connectors', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Connection profiles and the shared hub for backlog connectors to external work trackers.',
  },
  create: host => {
    const hub = new Hub(host.environment);
    return {
      provides: { connectors: hub },
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
