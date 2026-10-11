import type { Command } from '../../../application/plugins/registry.ts';
import { isRecord } from '../../../domain/shared/errors.ts';
import { retranslate } from '../../../domain/shared/messages.ts';
import { claudeMessages, type ClaudeMessage } from '../domain/messages.ts';

/** German texts of `claude` results; field names, paths and Claude Code terms stay as written. */
export const germanClaudeMessages: Record<ClaudeMessage, string> = {
  componentFileMissing: 'Die Komponentendatei des Manifests wurde unter den regulären Plugin-Dateien nicht gefunden.',
  componentPathEmpty: 'Unter diesem deklarierten Komponentenpfad wurden keine regulären Dateien gefunden; er ist möglicherweise leer oder fehlt. Die Validierung von Claude Code prüft, ob das Verzeichnis existiert.',
  ignoredAgentField: 'Claude ignoriert {key} in Plugin-Agenten; verwenden Sie für agentenspezifische Konfiguration einen Projekt- oder Benutzeragenten.',
  noCodeExecuted: 'Es wurden kein Plugin-Code, keine Hooks und keine MCP- oder LSP-Server ausgeführt.',
  claudeAuthoritative: 'Für Laufzeitkompatibilität und versionsspezifische Felder bleibt Claude Code maßgeblich.',
  pluginValidation: 'Bekannte Manifestformen und enthaltene relative Pfade; unbekannte Felder bleiben erhalten. Referenzierte Dateien, installierte Versionen und das Laufzeitverhalten erfordern die Validierung durch Claude Code.',
  agentRestrictions: 'Andere Berechtigungsregeln und verwaltete Einstellungen können diesen Agenten weiterhin einschränken.',
  pluginAgentLimitations: 'Claude Code ignoriert hooks, mcpServers, permissionMode und initialPrompt in Plugin-Agenten.',
  hookValidation: 'Konfiguration; Hook-Code wird nicht ausgeführt',
  agentFormat: 'Markdown mit YAML-Frontmatter',
  hookExecution: 'Claude Code führt Hooks aus; Forge führt nie Hook-Handler aus.',
  mutationScope: 'project, wo der native Befehl einen Bereich unterstützt',
  lifecycleDryRun: 'Gibt die Befehlsargumente zurück, ohne Claude Code zu starten.',
};

/** `value` with every text from the claude message catalog in the response language. */
function localized(value: unknown): unknown {
  if (typeof value === 'string') return retranslate(value, claudeMessages, germanClaudeMessages);
  if (Array.isArray(value)) return value.map(localized);
  return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, localized(entry)])) : value;
}

/** The `claude` command with the texts of its results in the response language. */
export function withLocalizedResults(command: Command): Command {
  return {
    ...command,
    async run(args, flags, context) {
      const result = await command.run(args, flags, context);
      return context.language === 'en' ? result : localized(result);
    },
  };
}
