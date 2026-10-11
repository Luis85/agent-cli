/** German server help metadata; composed into the kernel localization catalogs. */
export const germanServerCommands: Record<string, string> = {
  server: 'Den lokalen Workspace-Server verwalten und seine installierten Webviews entdecken.',
};
export const germanServerActions: Record<string, string> = {
  'server status': 'Den Workspace-Server prüfen, ohne ihn zu starten oder gespeicherten Zustand zu ändern.',
  'server start': 'Den lokalen Server starten oder wiederverwenden und seine authentifizierte URL zurückgeben; kein Browser wird geöffnet.',
  'server stop': 'Den verifizierten Workspace-Server beenden; wiederholtes Beenden hat keine weitere Wirkung.',
};
export const germanServerDescriptions: Record<string, string> = {
  'status (default), start or stop.': 'status (Standard), start oder stop.',
  'TCP port from 0 to 65535; 0 chooses an available port.': 'TCP-Port von 0 bis 65535; 0 wählt einen verfügbaren Port.',
  'Installed webview id to include in the launch URL, such as admin.': 'ID einer installierten Webview für die Start-URL, zum Beispiel admin.',
};
