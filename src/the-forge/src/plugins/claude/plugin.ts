import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { ClaudeLifecycle } from './application/lifecycle.ts';
import type { ClaudeLifecycleClient } from '../../application/plugins/claude-lifecycle.ts';
import { claudeEvents } from './application/events.ts';
import { claudeAgentCodec } from './infrastructure/agents.ts';
import { claudeTarget } from './infrastructure/target.ts';
import { NodeClaudeRuntime } from './infrastructure/runtime.ts';
import { claudeCommand } from './presentation/commands.ts';
import { claudeStrings } from './presentation/strings.ts';
import { claudeText } from './presentation/messages.ts';

/** The service id of the Claude lifecycle client that trusted plugins require. */
const claudeLifecycleService = 'claude.lifecycle';

/**
 * The `claude` core plugin: the `claude` command family for native Claude Code agents, hooks and plugin assets, the
 * installed CLI lifecycle (plugins, marketplaces, runtime), and its `claude.*` lifecycle records. It provides
 * `claude.lifecycle`, a `ClaudeLifecycleClient` bound on activation to the invocation's root and dry-run setting;
 * plugins that run Claude Code declare `requires: ['claude.lifecycle']`.
 */
export const claudePlugin: CorePlugin = {
  manifest: {
    id: 'claude', name: 'Claude Code', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Manage native Claude Code agents, hooks and plugins, and run the installed Claude Code CLI lifecycle.',
  },
  strings: claudeStrings,
  create: host => {
    let lifecycle: ClaudeLifecycle | undefined;
    const client: ClaudeLifecycleClient = {
      execute: request => {
        ensure(lifecycle, 'PLUGIN_LIFECYCLE', 'The claude.lifecycle service runs Claude only while the claude plugin is active in a command invocation.');
        return lifecycle.execute(request);
      },
    };
    return {
      commands: [claudeCommand({ agentCodec: claudeAgentCodec, target: claudeTarget(host.openFiles), lifecycle: client })],
      events: [...claudeEvents],
      provides: { [claudeLifecycleService]: client },
      onload(context) {
        lifecycle = new ClaudeLifecycle(executable => new NodeClaudeRuntime({ executable }), { cwd: context.root, dryRun: context.workspace.dryRun }, context.events, () => host.operationId(), claudeText(context.language));
      },
      onunload() { lifecycle = undefined; },
      strings: {
        de: {
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
        },
      },
    };
  },
};
