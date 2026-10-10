import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import { ensure } from '../../domain/shared/errors.ts';
import { ClaudeLifecycle } from './application/lifecycle.ts';
import type { ClaudeLifecycleClient } from '../../application/plugins/claude-lifecycle.ts';
import { claudeEvents } from './application/events.ts';
import { claudeAgentCodec } from './infrastructure/agents.ts';
import { claudeTarget } from './infrastructure/target.ts';
import { NodeClaudeRuntime } from './infrastructure/runtime.ts';
import { claudeCommand } from './presentation/commands.ts';

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
        lifecycle = new ClaudeLifecycle(executable => new NodeClaudeRuntime({ executable }), { cwd: context.root, dryRun: context.workspace.dryRun }, context.events, () => host.operationId());
      },
      onunload() { lifecycle = undefined; },
      strings: {
        de: {
          commands: { claude: 'Native Claude-Code-Agenten, Hooks und Plugins mit Revisionsschutz und installiertem CLI verwalten.' },
          actions: {
            'claude capabilities': 'Unterstützte Formate, Bereiche und Vorgänge beschreiben.',
            'claude agents': 'Native Agenten auflisten, prüfen, erstellen, aktualisieren, entfernen, aktivieren, deaktivieren oder exportieren.',
            'claude hooks': 'Die native Hook-Konfiguration prüfen, kontrollieren und bearbeiten.',
            'claude plugins': 'Claude-Plugin-Bestandteile erstellen oder den Plugin-Lebenszyklus des installierten CLI ausführen.',
            'claude marketplaces': 'Plugin-Marktplätze über das installierte CLI hinzufügen, auflisten, entfernen oder aktualisieren.',
            'claude runtime': 'Das installierte Claude-Code-CLI melden, diagnostizieren, installieren oder aktualisieren.',
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
