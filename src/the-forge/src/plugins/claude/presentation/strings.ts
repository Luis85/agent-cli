import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';
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
