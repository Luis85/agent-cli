import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

/** English `browser status` recovery guidance, keyed by status source and by the reasons that need a check first. */
const englishMessages: Record<string, string> = {
  'status.source.managed': 'Run browser install or pass --browser-executable for an installed Chromium.',
  'status.source.environment': 'Update FORGE_BROWSER_EXECUTABLE or pass --browser-executable for an installed Chromium.',
  'status.source.explicit': 'Pass --browser-executable with the path to an installed Chromium.',
  'status.reason.not-executable': 'Check execution permissions on the selected file.',
  'status.reason.inaccessible': 'Check access to the selected path and its parent directories.',
};

const germanMessages: Record<string, string> = {
  'status.source.managed': 'Führen Sie browser install aus oder übergeben Sie mit --browser-executable einen installierten Chromium-Browser.',
  'status.source.environment': 'Passen Sie FORGE_BROWSER_EXECUTABLE an oder übergeben Sie mit --browser-executable einen installierten Chromium-Browser.',
  'status.source.explicit': 'Übergeben Sie mit --browser-executable den Pfad zu einem installierten Chromium-Browser.',
  'status.reason.not-executable': 'Prüfen Sie die Ausführungsrechte der ausgewählten Datei.',
  'status.reason.inaccessible': 'Prüfen Sie den Zugriff auf den ausgewählten Pfad und seine übergeordneten Ordner.',
};

export const browserStrings: PluginStrings = { en: { messages: englishMessages }, de: {
  messages: germanMessages,
  manifest: { name: 'Browser-Werkzeuge', description: 'Geschützte Webseiten-Screenshots und wiederholbare bebilderte Anleitungen mit einem verwalteten Browser erstellen.' },
  commands: { browser: 'Webseiten-Screenshots und wiederholbare bebilderte Anleitungen über das portable CLI erstellen.' },
  actions: {
    'browser status': 'Die Verfügbarkeit der ausführbaren Datei ohne Browserstart oder Prüfung der Browser-Kompatibilität prüfen.',
    'browser install': 'Den verwalteten Chromium-Browser ausdrücklich herunterladen; ein Probelauf startet keine Installation.',
    'browser screenshot': 'Einen Webseiten-Screenshot als geschützte PNG-Datei speichern und eine Markdown-Bildreferenz zurückgeben.',
    'browser validate': 'Einen deklarierten Anleitungsablauf ohne Browser prüfen und die Ausgaberevision anzeigen.',
    'browser tutorial': 'Einen deklarierten Ablauf ausführen und Anleitung, Screenshots und wiederholbaren Plan atomar speichern.',
  },
  descriptions: {
    'status (default), install, screenshot, validate or tutorial.': 'status (Standard), install, screenshot, validate oder tutorial.',
    'Absolute HTTP(S) URL for screenshot, or a project-relative flow JSON, Markdown or Canvas source.': 'Absolute HTTP(S)-URL für screenshot oder projektrelative JSON-, Markdown- oder Canvas-Ablaufquelle.',
    'Use this project instead of the selected project.': 'Dieses Projekt statt des ausgewählten Projekts verwenden.',
    'Use this Chromium executable; otherwise use FORGE_BROWSER_EXECUTABLE or the installed managed browser.': 'Diese Chromium-Datei verwenden; sonst FORGE_BROWSER_EXECUTABLE oder den installierten verwalteten Browser verwenden.',
    'Browser operation timeout in milliseconds, from 1 to 120000.': 'Zeitlimit für Browser-Vorgänge in Millisekunden von 1 bis 120000.',
    'Current output revision from read (screenshot) or browser validate (tutorial); required before replacing existing output.': 'Aktuelle Ausgaberevision aus read (Screenshot) oder browser validate (Anleitung); zum Ersetzen vorhandener Ausgaben erforderlich.',
    'Project-relative PNG output path.': 'Projektrelativer PNG-Ausgabepfad.',
    'Viewport width in pixels, from 1 to 7680.': 'Ansichtsbreite in Pixeln von 1 bis 7680.',
    'Viewport height in pixels, from 1 to 7680.': 'Ansichtshöhe in Pixeln von 1 bis 7680.',
    'Capture the full page instead of only the viewport.': 'Die vollständige Seite statt nur des sichtbaren Ausschnitts erfassen.',
    'Wait for this selector to become visible before capturing the page.': 'Vor der Aufnahme warten, bis dieser Selektor sichtbar ist.',
    'Optional project-relative tutorial directory whose current revision should be inspected.': 'Optionaler projektrelativer Anleitungsordner, dessen aktuelle Revision geprüft werden soll.',
    'Project-relative tutorial directory for index.md, screenshots and flow.json.': 'Projektrelativer Anleitungsordner für index.md, Screenshots und flow.json.',
  },
  errors: {
    BROWSER_UNAVAILABLE: { summary: 'Browser-Laufzeit oder ausführbare Datei fehlen.', hint: 'Prüfen Sie browser status und führen Sie browser install aus oder übergeben Sie einen installierten Chromium-Browser mit --browser-executable.' },
    BROWSER_CAPTURE_FAILED: { summary: 'Die Webseite konnte nicht aufgenommen werden.', hint: 'Prüfen Sie URL, Browser-Verfügbarkeit und Bereitschaftsselektor; es wurde kein Screenshot geschrieben.' },
    BROWSER_INSTALL_FAILED: { summary: 'Die Installation des verwalteten Browsers ist fehlgeschlagen.', hint: 'Prüfen Sie Netzwerkzugriff und Schreibrechte; wiederholen Sie browser install oder verwenden Sie --browser-executable.' },
    BROWSER_FLOW_INVALID: { summary: 'Der deklarierte Anleitungsablauf ist ungültig.', hint: 'Prüfen Sie browser validate und korrigieren Sie die genannte Quelle, Aktion, Auswahl oder den Ausgabepfad.' },
    BROWSER_FLOW_FAILED: { summary: 'Der Anleitungsablauf konnte nicht abgeschlossen werden.', hint: 'Prüfen Sie den fehlgeschlagenen Schritt und korrigieren Sie den Ablauf; vorhandene Anleitungen wurden erhalten.' },
  },
} };
