import type { PluginErrorDefinition } from '../../../application/plugins/plugin-catalog.ts';
import { claudeErrorCategories } from '../domain/errors.ts';

const argumentsHint = 'Correct the arguments named in the message; run help <command> for usage.';
const claudeDefinitionHint = 'Fix the field named in the message, then rerun the command.';
const germanArgumentsHint = 'Korrigieren Sie die in der Meldung genannten Argumente; die Verwendung zeigt help <command>.';
const germanClaudeDefinitionHint = 'Korrigieren Sie das in der Meldung genannte Feld und führen Sie den Befehl erneut aus.';

/** The failure codes the claude plugin registers; their categories fix the exit statuses. */
export const claudeErrors: PluginErrorDefinition[] = [
  { code: 'INVALID_CLAUDE_PLUGIN', category: claudeErrorCategories.INVALID_CLAUDE_PLUGIN, summary: 'The Claude plugin manifest or a plugin file is invalid.', hint: claudeDefinitionHint },
  { code: 'INVALID_CLAUDE_COMMAND', category: claudeErrorCategories.INVALID_CLAUDE_COMMAND, summary: 'The Claude command is not supported.', hint: 'Run claude capabilities.' },
  { code: 'INVALID_CLAUDE_ARGUMENT', category: claudeErrorCategories.INVALID_CLAUDE_ARGUMENT, summary: 'A Claude command argument is invalid.', hint: argumentsHint },
  { code: 'INVALID_CLAUDE_OPTION', category: claudeErrorCategories.INVALID_CLAUDE_OPTION, summary: 'A Claude option has an invalid value or combination.', hint: 'Run help claude and correct the option the message names.' },
  { code: 'INVALID_CLAUDE_SCOPE', category: claudeErrorCategories.INVALID_CLAUDE_SCOPE, summary: 'The Claude scope is invalid.', hint: 'Run help claude and pass a --scope value supported by that action.' },
  { code: 'INVALID_CLAUDE_INPUT', category: claudeErrorCategories.INVALID_CLAUDE_INPUT, summary: 'The Claude input is invalid or too large.', hint: 'Pass valid input within the size limit.' },
  { code: 'INVALID_CLAUDE_OUTPUT', category: claudeErrorCategories.INVALID_CLAUDE_OUTPUT, summary: 'The Claude output format is invalid.', hint: 'Use text, json or json-last-line.' },
  { code: 'INVALID_CLAUDE_OUTPUT_LIMIT', category: claudeErrorCategories.INVALID_CLAUDE_OUTPUT_LIMIT, summary: 'The Claude output limit is invalid.', hint: 'Use a positive integer number of bytes.' },
  { code: 'INVALID_CLAUDE_TIMEOUT', category: claudeErrorCategories.INVALID_CLAUDE_TIMEOUT, summary: 'The Claude timeout is invalid.', hint: 'Pass the timeout in milliseconds within the range named in the message.' },
  { code: 'INVALID_CLAUDE_EXECUTABLE', category: claudeErrorCategories.INVALID_CLAUDE_EXECUTABLE, summary: 'The Claude executable path is invalid.', hint: 'Pass an executable path to --claude-bin.' },
  { code: 'CLAUDE_NOT_INSTALLED', category: claudeErrorCategories.CLAUDE_NOT_INSTALLED, summary: 'The Claude Code executable was not found.', hint: 'Install Claude Code and put claude on PATH, or pass --claude-bin.' },
  { code: 'CLAUDE_WORKING_DIRECTORY_UNAVAILABLE', category: claudeErrorCategories.CLAUDE_WORKING_DIRECTORY_UNAVAILABLE, summary: 'The Claude working directory is unavailable.', hint: 'Check that the selected project or workspace root exists and is a directory.' },
  { code: 'CLAUDE_COMMAND_FAILED', category: claudeErrorCategories.CLAUDE_COMMAND_FAILED, summary: 'Claude Code could not be started or stopped unexpectedly.', hint: 'Read error.details, inspect external state, then retry deliberately.' },
  { code: 'CLAUDE_COMMAND_TIMEOUT', category: claudeErrorCategories.CLAUDE_COMMAND_TIMEOUT, summary: 'The Claude command exceeded its timeout.', hint: 'Inspect external state; retry with a larger --timeout only if the work did not complete.' },
  { code: 'CLAUDE_OUTPUT_LIMIT', category: claudeErrorCategories.CLAUDE_OUTPUT_LIMIT, summary: 'Claude output exceeded the size limit.', hint: 'Inspect external state; retry with a larger output limit only if needed.' },
  { code: 'CLAUDE_COMMAND_INTERRUPTED', category: claudeErrorCategories.CLAUDE_COMMAND_INTERRUPTED, summary: 'The Claude command was interrupted by a signal (exit 130 for SIGINT, 143 for SIGTERM).', hint: 'Inspect external state before running the command again.' },
  { code: 'CLAUDE_RUNTIME_FAILED', category: claudeErrorCategories.CLAUDE_RUNTIME_FAILED, summary: 'Claude Code exited with a nonzero status.', hint: 'Inspect error.details (native status, output and parsed result) and external state before retrying.' },
  { code: 'CLAUDE_INVALID_OUTPUT', category: claudeErrorCategories.CLAUDE_INVALID_OUTPUT, summary: 'Claude Code succeeded but did not return the requested JSON.', hint: 'Inspect stdout and external state before retrying.' },
];

/** German summaries and next steps of the claude plugin's failure codes. */
export const germanClaudeErrors: Record<string, { summary: string; hint: string }> = {
  INVALID_CLAUDE_PLUGIN: { summary: 'Das Claude-Plugin-Manifest oder eine Plugin-Datei ist ungültig.', hint: germanClaudeDefinitionHint },
  INVALID_CLAUDE_COMMAND: { summary: 'Dieser Claude-Befehl wird nicht unterstützt.', hint: 'Unterstützte Befehle zeigt claude capabilities.' },
  INVALID_CLAUDE_ARGUMENT: { summary: 'Ein Argument des Claude-Befehls ist ungültig.', hint: germanArgumentsHint },
  INVALID_CLAUDE_OPTION: { summary: 'Eine Claude-Option hat einen ungültigen Wert oder eine ungültige Kombination.', hint: 'Prüfen Sie help claude und korrigieren Sie die in der Meldung genannte Option.' },
  INVALID_CLAUDE_SCOPE: { summary: 'Der Claude-Geltungsbereich ist ungültig.', hint: 'Prüfen Sie help claude und übergeben Sie einen für diese Aktion unterstützten --scope.' },
  INVALID_CLAUDE_INPUT: { summary: 'Die Claude-Eingabe ist ungültig oder zu groß.', hint: 'Übergeben Sie gültige Eingaben innerhalb des Größenlimits.' },
  INVALID_CLAUDE_OUTPUT: { summary: 'Das Claude-Ausgabeformat ist ungültig.', hint: 'Verwenden Sie text, json oder json-last-line.' },
  INVALID_CLAUDE_OUTPUT_LIMIT: { summary: 'Das Claude-Ausgabelimit ist ungültig.', hint: 'Verwenden Sie eine positive ganze Zahl von Bytes.' },
  INVALID_CLAUDE_TIMEOUT: { summary: 'Das Claude-Zeitlimit ist ungültig.', hint: 'Geben Sie das Zeitlimit in Millisekunden innerhalb des in der Meldung genannten Bereichs an.' },
  INVALID_CLAUDE_EXECUTABLE: { summary: 'Der Pfad zur Claude-Code-CLI ist ungültig.', hint: 'Übergeben Sie einen ausführbaren Pfad an --claude-bin.' },
  CLAUDE_NOT_INSTALLED: { summary: 'Die Claude-Code-CLI wurde nicht gefunden.', hint: 'Installieren Sie Claude Code und nehmen Sie claude in PATH auf oder verwenden Sie --claude-bin.' },
  CLAUDE_WORKING_DIRECTORY_UNAVAILABLE: { summary: 'Das Arbeitsverzeichnis für Claude Code ist nicht verfügbar.', hint: 'Prüfen Sie, dass das ausgewählte Projekt oder der Workspace existiert und ein Verzeichnis ist.' },
  CLAUDE_COMMAND_FAILED: { summary: 'Claude Code konnte nicht gestartet werden oder wurde unerwartet beendet.', hint: 'Lesen Sie error.details, prüfen Sie den externen Zustand und wiederholen Sie dann bewusst.' },
  CLAUDE_COMMAND_TIMEOUT: { summary: 'Der Claude-Befehl hat sein Zeitlimit überschritten.', hint: 'Prüfen Sie den externen Zustand; wiederholen Sie mit größerem --timeout nur, wenn die Arbeit nicht abgeschlossen wurde.' },
  CLAUDE_OUTPUT_LIMIT: { summary: 'Die Claude-Ausgabe hat das Größenlimit überschritten.', hint: 'Prüfen Sie den externen Zustand; wiederholen Sie nur bei Bedarf mit größerem Ausgabelimit.' },
  CLAUDE_COMMAND_INTERRUPTED: { summary: 'Der Claude-Befehl wurde durch ein Signal unterbrochen (Exit 130 bei SIGINT, 143 bei SIGTERM).', hint: 'Prüfen Sie den externen Zustand, bevor Sie den Befehl erneut ausführen.' },
  CLAUDE_RUNTIME_FAILED: { summary: 'Claude Code wurde mit einem Status ungleich null beendet.', hint: 'Prüfen Sie error.details (nativer Status, Ausgabe und geparstes Ergebnis) und den externen Zustand vor einer Wiederholung.' },
  CLAUDE_INVALID_OUTPUT: { summary: 'Claude Code war erfolgreich, lieferte aber nicht das angeforderte JSON.', hint: 'Prüfen Sie stdout und den externen Zustand vor einer Wiederholung.' },
};
