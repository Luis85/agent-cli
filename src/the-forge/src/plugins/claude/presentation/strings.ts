import type { PluginStrings, PluginStringTable } from '../../../application/plugins/plugin-catalog.ts';
import { retranslate } from '../../../domain/shared/messages.ts';
import { claudeRuntimeOptions } from './runtime-commands.ts';
import { germanClaudeErrors } from './errors.ts';

/** The descriptions of options passed through to the native Claude Code CLI; the list form must match first. */
const passthrough = {
  list: 'Passed to the native Claude Code CLI as --{name} (one string or a JSON array) by {actions}.',
  flag: 'Passed to the native Claude Code CLI as --{name} by {actions}.',
};
const germanPassthrough: Record<keyof typeof passthrough, string> = {
  list: 'Von {actions} als --{name} (eine Zeichenkette oder ein JSON-Array) an die native Claude-Code-CLI übergeben.',
  flag: 'Von {actions} als --{name} an die native Claude-Code-CLI übergeben.',
};

/** The claude plugin's German manifest and option and argument descriptions, available while it is disabled. */
export const claudeStrings: PluginStrings = {
  de: {
    errors: germanClaudeErrors,
    manifest: { name: 'Claude-Code-Verwaltung', description: 'Native Claude-Code-Agenten, -Hooks und -Plugins verwalten und den Lebenszyklus der installierten Claude-Code-CLI ausführen.' },
    descriptions: {
      ...Object.fromEntries(Object.values(claudeRuntimeOptions).map(({ description }) => [description, retranslate(description, passthrough, germanPassthrough)])),
      'Claude configuration scope (default project). Agent files of the project, the user or a plugin.': 'Claude-Konfigurationsbereich (Standard project). Agentendateien des Projekts, des Benutzers oder eines Plugins.',
      'Claude configuration scope (default project). Hook settings of the project, local settings, the user or a plugin.': 'Claude-Konfigurationsbereich (Standard project). Hook-Einstellungen des Projekts, der lokalen Einstellungen, des Benutzers oder eines Plugins.',
      'Claude configuration scope (default project). Installed-CLI plugin commands: the native scope; managed only with plugins update.': 'Claude-Konfigurationsbereich (Standard project). Plugin-Befehle der installierten CLI: der native Bereich; managed nur mit plugins update.',
      'Claude configuration scope (default project). Marketplace add and remove: the native scope.': 'Claude-Konfigurationsbereich (Standard project). Marketplace add und remove: der native Bereich.',
      'Plugin directory for plugin-scoped agents and hooks.': 'Plugin-Verzeichnis für Agenten und Hooks im Plugin-Bereich.',
      'Claude user configuration directory for user scope.': 'Claude-Benutzerkonfigurationsverzeichnis für den Benutzerbereich.',
      'Read native input from a file.': 'Native Eingabe aus einer Datei lesen.',
      'Native input as literal text.': 'Native Eingabe als wörtlicher Text.',
      'Read native input from piped standard input.': 'Native Eingabe aus der umgeleiteten Standardeingabe lesen.',
      'JSON metadata for agent create or update.': 'JSON-Metadaten für agent create oder update.',
      'Agent system prompt for create or update.': 'System-Prompt des Agenten für create oder update.',
      'SHA-256 revision the native file must still have.': 'SHA-256-Revision, die die native Datei noch haben muss.',
      'Destination path for export.': 'Zielpfad für export.',
      'Hook entry index for hooks remove.': 'Index des Hook-Eintrags für hooks remove.',
      'Path of the Claude Code executable; defaults to claude on PATH.': 'Pfad der ausführbaren Claude-Code-Datei; standardmäßig claude im PATH.',
      'Native process timeout in milliseconds (1 to 3600000).': 'Zeitlimit des nativen Prozesses in Millisekunden (1 bis 3600000).',
      'capabilities (default), agents, hooks, plugins, marketplaces or runtime.': 'capabilities (Standard), agents, hooks, plugins, marketplaces oder runtime.',
      'The section action and its operands; see usage.': 'Die Aktion des Bereichs und ihre Operanden; siehe usage.',
    },
  },
};

/** German descriptions of the claude plugin's command, actions and lifecycle events. */
export const de: PluginStringTable = {
  commands: { claude: 'Native Claude-Code-Agenten, Hooks und Plugins mit Revisionsschutz und installiertem CLI verwalten.' },
  actions: {
    'claude capabilities': 'Unterstützte Formate, Bereiche und Vorgänge beschreiben.',
    'claude agents': 'Native Agenten auflisten, wie agents list.',
    'claude agents list': 'Native Agenten auflisten.',
    'claude agents inspect': 'Einen nativen Agenten mit Metadaten und Prompt zurückgeben.',
    'claude agents create': 'Eine native Agentendatei anlegen.',
    'claude agents update': 'Eine native Agentendatei ersetzen.',
    'claude agents remove': 'Eine native Agentendatei entfernen.',
    'claude agents enable': 'Einen nativen Agenten in den Einstellungen aktivieren.',
    'claude agents disable': 'Einen nativen Agenten in den Einstellungen deaktivieren.',
    'claude agents export': 'Einen nativen Agenten als Markdown und Sitzungs-JSON zurückgeben oder mit --out in eine .md-Datei schreiben.',
    'claude hooks': 'Die native Hook-Konfiguration prüfen, wie hooks inspect.',
    'claude hooks inspect': 'Die native Hook-Konfiguration prüfen.',
    'claude hooks check': 'Die native Hook-Konfiguration validieren.',
    'claude hooks set': 'Die Hook-Konfiguration durch JSON-Eingabe ersetzen.',
    'claude hooks add': 'Einen Hook-Eintrag für ein Ereignis aus JSON-Eingabe hinzufügen.',
    'claude hooks remove': 'Die Hooks eines Ereignisses entfernen, oder mit --index einen Eintrag.',
    'claude hooks configure': 'Hook-bezogene Einstellungen aus JSON-Eingabe setzen.',
    'claude hooks enable': 'Alle Hooks der Einstellungsdatei aktivieren.',
    'claude hooks disable': 'Alle Hooks der Einstellungsdatei deaktivieren.',
    'claude plugins create': 'Ein Claude-Plugin-Verzeichnis aus einem JSON-Manifest anlegen.',
    'claude plugins inspect': 'Ein Claude-Plugin-Verzeichnis und seine Bestandteile beschreiben.',
    'claude plugins manifest': 'Das Plugin-Manifest durch JSON-Eingabe ersetzen.',
    'claude plugins check': 'Ein Claude-Plugin-Verzeichnis validieren.',
    'claude plugins asset': 'Einen Bestandteil eines Claude-Plugins lesen.',
    'claude plugins write-asset': 'Einen Bestandteil eines Claude-Plugins schreiben.',
    'claude plugins remove-asset': 'Einen Bestandteil eines Claude-Plugins entfernen.',
    'claude plugins list': 'Installierte Plugins auflisten, oder mit --available verfügbare.',
    'claude plugins details': 'Ein installiertes Plugin beschreiben.',
    'claude plugins install': 'Ein Plugin aus einem Marktplatz installieren.',
    'claude plugins update': 'Ein installiertes Plugin aktualisieren.',
    'claude plugins uninstall': 'Ein Plugin deinstallieren.',
    'claude plugins enable': 'Ein installiertes Plugin aktivieren.',
    'claude plugins disable': 'Ein Plugin deaktivieren, oder mit --all jedes Plugin.',
    'claude plugins validate': 'Ein Plugin oder einen Marktplatz mit dem installierten CLI validieren.',
    'claude plugins configure': 'Die Optionen eines installierten Plugins konfigurieren; --values-stdin liest die Werte als JSON-Eingabe.',
    'claude plugins prune': 'Plugins entfernen, die nichts mehr benötigt.',
    'claude plugins init': 'Ein neues Plugin mit dem installierten CLI erzeugen.',
    'claude plugins tag': 'Ein Plugin-Release taggen.',
    'claude plugins test': 'Die Tests eines Plugins ausführen.',
    'claude plugins eval': 'Die Evaluationsfälle eines Plugins ausführen.',
    'claude plugins eval init': 'Evaluationsfälle für ein Plugin anlegen.',
    'claude marketplaces add': 'Einen Plugin-Marktplatz hinzufügen.',
    'claude marketplaces list': 'Die konfigurierten Marktplätze auflisten.',
    'claude marketplaces remove': 'Einen Marktplatz entfernen.',
    'claude marketplaces update': 'Einen Marktplatz oder alle aktualisieren.',
    'claude runtime version': 'Die installierte Claude-Code-Version melden.',
    'claude runtime doctor': 'Das installierte Claude-Code-CLI diagnostizieren.',
    'claude runtime install': 'Claude Code installieren, optional eine Version oder einen Kanal.',
    'claude runtime update': 'Das installierte Claude-Code-CLI aktualisieren.',
  },
  events: {
    'claude.started': 'Ein Claude-Aufruf hat mit Prüfung oder Vorschau begonnen.',
    'claude.succeeded': 'Ein Claude-Aufruf oder eine geprüfte Vorschau wurde abgeschlossen.',
    'claude.failed': 'Prüfung, Ausführung oder Ausgabeverarbeitung von Claude ist fehlgeschlagen.',
    'claude.executed': 'Der Claude-Prozess hat einen Exit-Status geliefert, auch einen von null verschiedenen.',
  },
};
