import type { PluginStrings, PluginStringTable } from '../../../application/plugins/plugin-catalog.ts';

/** German descriptions of the connector plugin's command, actions and events, and its error summaries and hints. */
export const de: PluginStringTable = {
  commands: { connectors: 'Die in plugins.settings.connector.connections konfigurierten Backlog-Verbindungen auflisten, prüfen und testen.' },
  actions: {
    'connectors list': 'Jede Verbindung mit Plattform, Gültigkeit, Warnungen und der Angabe, ob ihre Token-Variable gesetzt ist.',
    'connectors inspect': 'Eine Verbindung mit ihren aufgelösten Typ-, Status- und Feldzuordnungen.',
    'connectors test': 'Eine authentifizierte, nur lesende Prüfung einer Verbindung.',
  },
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

/** The connector plugin's German manifest and argument and settings descriptions, available while it is disabled. */
export const connectorStrings: PluginStrings = {
  de: {
    manifest: { name: 'Connector-Verbindungen', description: 'Verbindungsprofile und der gemeinsame Hub für Backlog-Connectors zu externen Work-Trackern.' },
    descriptions: {
      'list, inspect, test': 'list, inspect oder test',
      'The connection id (inspect, test).': 'Die Verbindungs-ID (inspect, test).',
      'Connection profiles by id (lowercase kebab-case).': 'Verbindungsprofile nach ID (kebab-case in Kleinbuchstaben).',
      'The connector platform, for example azure-devops.': 'Die Connector-Plattform, zum Beispiel azure-devops.',
      'The environment variable holding the access token, named PAT, TOKEN or ending in _PAT or _TOKEN so a shared profile cannot pick an unrelated secret; the platform default when omitted. Its value is sent to the organization, so review both in shared configuration.': 'Die Umgebungsvariable mit dem Zugriffstoken, benannt PAT, TOKEN oder mit der Endung _PAT oder _TOKEN, damit ein gemeinsam genutztes Profil kein fremdes Geheimnis wählen kann; ohne Angabe der Standard der Plattform. Ihr Wert wird an die Organisation gesendet; prüfen Sie daher beide in gemeinsam genutzter Konfiguration.',
      'The frontmatter key that links a note to its remote item; the platform default when omitted.': 'Der Frontmatter-Schlüssel, der eine Notiz mit ihrem entfernten Eintrag verknüpft; ohne Angabe der Standard der Plattform.',
      'The frontmatter key of the effort or story points.': 'Der Frontmatter-Schlüssel des Aufwands oder der Story Points.',
      'The frontmatter key of the area path; a note without it uses the connection\'s default area.': 'Der Frontmatter-Schlüssel des Bereichspfads; eine Notiz ohne ihn verwendet den Standardbereich der Verbindung.',
      'Local backlog type → remote work item type, over the process defaults.': 'Lokaler Backlog-Typ → entfernter Work-Item-Typ, vorrangig vor den Prozessstandards.',
      'Local state (optionally Type:State) → remote state, over the process defaults.': 'Lokaler Zustand (optional Typ:Zustand) → entfernter Zustand, vorrangig vor den Prozessstandards.',
      'Neutral field → remote field reference over the process defaults; an empty string stops syncing the field.': 'Neutrales Feld → entfernte Feldreferenz, vorrangig vor den Prozessstandards; eine leere Zeichenkette beendet den Abgleich des Felds.',
      'Extra frontmatter key → remote field reference, synced as a plain value.': 'Zusätzlicher Frontmatter-Schlüssel → entfernte Feldreferenz, als einfacher Wert abgeglichen.',
    },
  },
};
