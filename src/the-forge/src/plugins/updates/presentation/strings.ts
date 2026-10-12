import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

export const updatesStrings: PluginStrings = { de: {
  manifest: { name: 'App-Aktualisierungen', description: 'Das portable Programm aus GitHub Releases mit Revisionsschutz aktualisieren und Arbeitsbereichsdaten erhalten.' },
  commands: { update: 'GitHub Releases prüfen und das Programm dieses Arbeitsbereichs aktualisieren; lokale Einstellungen bleiben erhalten.' },
  actions: {
    'update check': 'Installierte Revision und neueste stabile GitHub-Version ohne Änderungen am Programm prüfen.',
    'update apply': 'Eine feste Version herunterladen, prüfen und als geschützten Stapel anwenden; veränderbare Arbeitsbereichsdaten erhalten.',
  },
  descriptions: {
    'check (default) or apply.': 'check (Standard) oder apply.',
    'Check this pinned stable release instead of resolving latest.': 'Diese feste stabile Version statt der neuesten Version prüfen.',
    'Stable GitHub release version to install, such as 0.1.0.': 'Zu installierende stabile GitHub-Version, etwa 0.1.0.',
    'Installed bin folder revision returned by update check; required before upgrading.': 'Installierte bin-Ordnerrevision aus update check; vor der Aktualisierung erforderlich.',
  },
  errors: {
    UPDATE_DOWNLOAD_FAILED: { summary: 'Die GitHub-Version konnte nicht abgerufen werden.', hint: 'Netzwerkzugriff, curl, tar und Speicherplatz prüfen; anschließend erneut versuchen.' },
    UPDATE_INVALID: { summary: 'Die Version oder das Archiv ist ungültig.', hint: 'Stabile Version, Prüfsumme und Verteilungsmanifest prüfen; das bestehende Programm bleibt erhalten.' },
    UPDATE_SCOPE_INVALID: { summary: 'Der Zielarbeitsbereich hat keine installierte Forge-Verteilung.', hint: 'Zuerst eine Version installieren oder --root auf den richtigen Arbeitsbereich setzen.' },
  },
} };
