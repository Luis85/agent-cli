import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

export const webviewsStrings: PluginStrings = { de: {
  manifest: { name: 'Webansichten', description: 'Eigenständige Webview-Projekte prüfen und ihre statischen Builds sicher lokal bereitstellen.' },
  commands: { webview: 'Das ausgewählte eigenständige Webview-Projekt prüfen und bereitstellen.' },
  actions: {
    'webview inspect': 'dist mit der installierten Webview vergleichen und ihre aktuelle Ordnerrevision zurückgeben.',
    'webview publish': 'dist mit Revisionsschutz bereitstellen oder mit --check ohne Schreibzugriff auf Abweichungen prüfen.',
  },
  descriptions: {
    'inspect (default) or publish.': 'inspect (Standard) oder publish.',
    'Inspect or publish this project instead of the selected one.': 'Dieses Projekt statt des ausgewählten Projekts prüfen oder bereitstellen.',
    'The installed folder revision from webview inspect; required to replace a changed view.': 'Die installierte Ordnerrevision aus webview inspect; zum Ersetzen einer geänderten Ansicht erforderlich.',
    'Check publication drift without writing; fail with WEBVIEW_DRIFT when assets differ.': 'Ohne Schreibzugriff auf Abweichungen prüfen; bei Unterschieden mit WEBVIEW_DRIFT fehlschlagen.',
  },
  errors: {
    WEBVIEW_INVALID: { summary: 'Der Webview-Build ist ungültig.', hint: 'Prüfen Sie dist und manifest.json; verwenden Sie nur reguläre statische Dateien und die Projekt-ID.' },
    WEBVIEW_BUILD_REQUIRED: { summary: 'Der Webview-Build fehlt.', hint: 'Führen Sie npm run build im ausgewählten Projekt aus und prüfen Sie danach webview inspect.' },
    WEBVIEW_PROJECT_REQUIRED: { summary: 'Das Projekt ist kein Webview-Projekt.', hint: 'Übergeben Sie --project <webview-id> oder führen Sie project open <webview-id> aus; project list zeigt den Typ jedes Projekts.' },
    WEBVIEW_DRIFT: { summary: 'Die installierte Webview weicht vom Build ab.', hint: 'Prüfen Sie webview inspect und veröffentlichen Sie den geprüften Build; bestehende Ansichten benötigen --if-match.' },
  },
} };
