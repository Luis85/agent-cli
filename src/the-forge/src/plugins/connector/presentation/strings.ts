import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

/** The connector plugin's German manifest and argument and settings descriptions, available while it is disabled. */
export const connectorStrings: PluginStrings = {
  de: {
    manifest: { name: 'Connector-Verbindungen', description: 'Verbindungsprofile und der gemeinsame Hub für Backlog-Connectors zu externen Work-Trackern.' },
    descriptions: {
      'list, inspect, test': 'list, inspect oder test',
      'The connection id (inspect, test).': 'Die Verbindungs-ID (inspect, test).',
      'Connection profiles by id (lowercase kebab-case).': 'Verbindungsprofile nach ID (kebab-case in Kleinbuchstaben).',
      'The connector platform, for example azure-devops.': 'Die Connector-Plattform, zum Beispiel azure-devops.',
      'The environment variable holding the access token; the platform default when omitted. Its value is sent to the organization, so review both in shared configuration.': 'Die Umgebungsvariable mit dem Zugriffstoken; ohne Angabe der Standard der Plattform. Ihr Wert wird an die Organisation gesendet; prüfen Sie daher beide in gemeinsam genutzter Konfiguration.',
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
