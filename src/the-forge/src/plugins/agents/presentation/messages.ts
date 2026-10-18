import type { Language } from '../../../application/plugins/plugin-catalog.ts';
import type { Command, CommandContext } from '../../../application/plugins/registry.ts';
import { isRecord } from '../../../domain/shared/errors.ts';
import { retranslate } from '../../../domain/shared/messages.ts';
import { agentFragments, agentMessages, type AgentMessage } from '../domain/messages.ts';

/** German mapping diagnostics; names, paths, rules, commands and docker-agent or Claude field names stay as written. */
export const germanAgentMessages: Record<AgentMessage, string> = {
  toolFilterNone: 'Der Werkzeugfilter {filter} wird durch keine Claude-Werkzeuge angenähert.',
  toolFilter: 'Der Werkzeugfilter {filter} wird durch die Claude-Werkzeuge {tools} angenähert.',
  toolsetFieldUnsupported: 'Das Feld {field} hat keine Claude-Entsprechung und wird nicht ausgegeben.',
  filesystemApproximated: 'Das Toolset filesystem wird durch die Claude-Werkzeuge {tools} angenähert.',
  allowListUnsupported: 'allow_list beschränkt das Toolset filesystem auf diese Verzeichnisse; Claude Code kann die Dateiwerkzeuge eines Agenten nicht auf Pfade begrenzen, daher wird die Beschränkung nicht ausgegeben. Fügen Sie deny-Regeln für Pfade hinzu, die der Agent nicht erreichen darf (permissions.additionalDirectories in den Projekteinstellungen erweitert den Zugriff nur).',
  denyListApproximated: 'deny_list wird mit --settings zu deny-Regeln für Read und Edit in den Projekteinstellungen.',
  readonlyShell: 'Ein schreibgeschütztes Toolset shell stellt in docker-agent keine Werkzeuge bereit; Bash wird nicht gewährt.',
  allowedDomainsUnsupported: 'allowed_domains beschränkt fetch auf diese Domains; Claude-Berechtigungsregeln können WebFetch nicht nur für einige Domains erlauben, daher wird die Beschränkung nicht ausgegeben.',
  blockedDomainsApproximated: 'blocked_domains wird mit --settings zu deny-Regeln WebFetch(domain:…) in den Projekteinstellungen; CIDR-Bereiche werden nicht ausgegeben.',
  taskToolsetApproximated: 'Das Toolset {type} wird durch Claudes Aufgabenwerkzeuge {tools} angenähert.',
  memoryApproximated: 'Das Toolset memory wird durch memory: project angenähert; sein Datenbankpfad wird nicht verwendet.',
  userPromptApproximated: 'Das Toolset user_prompt wird durch AskUserQuestion angenähert.',
  thinkNotEmitted: 'Das Toolset think wird nicht ausgegeben; Claude-Modelle denken von sich aus, gesteuert über effort.',
  mcpReadonly: 'Claude kann keine schreibgeschützten Werkzeuge des MCP-Servers {server} auswählen; jedes gewährte Werkzeug wird ausgegeben.',
  toolsetUnsupported: 'Das Toolset {type} hat keine Claude-Entsprechung und wird nicht ausgegeben.',
  readonlyApproximated: 'readonly behält schreibgeschützte Werkzeuge und verbietet {tools}.',
  mcpTemplateLiteral: 'Der Vorlagenausdruck {expression} hat keine Claude-MCP-Entsprechung und bleibt wörtlich erhalten.',
  oauthUnsupported: 'OAuth {field} wird nicht ausgegeben; Claude Code fragt Client-Geheimnisse interaktiv ab und handelt Scopes und Weiterleitungen selbst aus.',
  dockerGateway: '{ref} läuft über das Docker MCP Gateway: {command}.',
  mcpToolsetUnsupported: 'Das MCP-Toolset hat weder einen Befehl noch eine entfernte URL oder Docker-Referenz und wird nicht ausgegeben.',
  modelAlias: 'Das Modell {id} wird als Alias {alias} ausgegeben, den Claude Code zum neuesten Modell dieser Familie auflöst.',
  modelNoAlias: 'Das Modell {id} hat keinen Claude-Alias; seine ID wird ausgegeben.',
  effortLevel: 'thinking_budget {budget} wird als effort: {effort} ausgegeben.',
  effortBudget: 'Ein Denkbudget von {budget} Token wird als effort: {effort} angenähert.',
  effortNone: 'thinking_budget {budget} schaltet das Denken ab oder minimiert es; es wird kein effort ausgegeben.',
  modelSettingUnsupported: 'Die Modelleinstellung {key} hat keine Entsprechung in Claude-Agenten und wird nicht ausgegeben.',
  harnessUnsupported: 'Der Harness {type} hat keine Entsprechung in Claude-Agenten; der Agent erbt das Modell der Sitzung.',
  harnessApproximated: 'Der Harness claude-code führt den Agenten in Claude Code aus; sein Modell und effort werden am generierten Agenten ausgegeben.',
  modelMissing: 'Der Agent nennt kein Modell; der Claude-Agent erbt das Modell der Sitzung.',
  modelNoAnthropic: 'Das Modell {reference} hat keinen Anthropic-Kandidaten; der Claude-Agent erbt das Modell der Sitzung.',
  modelSelected: 'Das Modell {reference} wählt unter mehreren Modellen; der erste Anthropic-Kandidat {candidate} wird ausgegeben.',
  hookTypeUnsupported: 'Ein Hook vom Typ {type} hat keine Claude-Entsprechung und wird nicht ausgegeben.',
  hookFieldUnsupported: 'Das Hook-Feld {field} wird nicht ausgegeben.',
  hookEventUnsupported: 'Das Hook-Ereignis {event} hat keine Claude-Entsprechung und wird nicht ausgegeben.',
  hookMatcherApproximated: 'Für die Matcher-Alternativen {matchers} gibt es kein bekanntes Claude-Werkzeug; sie bleiben wörtlich erhalten.',
  preemptYolo: 'preempt_yolo wird nicht ausgegeben.',
  hookApproximated: '{event}-Hooks laufen beim Claude-Ereignis {target}, das die Hook-Eingabe von Claude Code sendet; prüfen Sie Eingabe- und Entscheidungsformat jedes Befehls.',
  commandUrl: 'Der Befehl /{command} öffnet eine URL, was ein Claude-Skill nicht kann; er wird nicht ausgegeben.',
  commandTemplateLiteral: 'Der Vorlagenausdruck {expression} bleibt wörtlich erhalten; Claude-Skills werten keine docker-agent-Ausdrücke aus.',
  bangToolCall: 'Der Bang-Werkzeugaufruf {call} bleibt wörtlich erhalten.',
  commandDescription: 'Der Befehl /{command} hat keine Beschreibung; "{description}" wird ausgegeben.',
  commandForked: 'docker-agent übergibt die Unterhaltung an {target}; der Claude-Skill läuft stattdessen in einem abgezweigten Subagenten {agent}.',
  mcpNotGenerated: 'Der MCP-Server {server} wird nicht generiert und seine Werkzeuge werden nicht gewährt; übergeben Sie --mcp inline oder --mcp project, um ihn zu schreiben. Sein Befehl oder seine URL: {target}',
  mcpExecutes: 'Der MCP-Server {server} (geschrieben in {file}) führt den Befehl aus: {command}',
  hooksNotGenerated: 'Hooks führen Befehle aus und werden nur mit --hooks generiert; übersprungen: {hooks}.',
  hookExecutes: 'Der {event}-Hook von {agent} führt den Befehl aus: {command}',
  toolsNone: 'Kein Toolset gewährt ein Claude-Werkzeug, daher erhält {agent} tools: [] und verbietet {tools}, statt jedes Werkzeug zu erben.',
  reasonNoBuiltin: 'nennt kein eingebautes docker-agent-Werkzeug mit einer Claude-Berechtigungsregel',
  reasonUnmappedOne: 'trifft {tools}, das keine Claude-Berechtigungsregel gleicher Reichweite hat',
  reasonUnmapped: 'trifft {tools}, die keine Claude-Berechtigungsregel gleicher Reichweite haben',
  reasonMcpNone: 'nennt einen MCP-Server, und ohne --mcp inline oder --mcp project wird kein MCP-Server generiert',
  reasonMcpUnknown: 'nennt den MCP-Server {server}, den kein generierter Agent definiert',
  reasonArguments: 'trifft Werkzeugargumente, die Claude-Berechtigungsregeln nur für Shell-Befehle ausdrücken',
  permissionPartial: 'Das {list}-Muster {pattern} {reason}; nur {rules} wird ausgegeben.',
  permissionDropped: 'Das {list}-Muster {pattern} {reason}; es wird nicht ausgegeben.',
  permissionApproximated: 'permissions.{list} wird zu Claude-Berechtigungsregeln in .claude/settings.json; der Abgleich von Argumenten wird angenähert.',
  broadPermission: 'Die Regel {rule} würde jede Verwendung ihres Werkzeugs automatisch freigeben; übergeben Sie --allow-broad-permissions, um sie in permissions.allow zu schreiben, oder grenzen Sie das docker-agent-Muster ein.',
  grantsPermissionBroad: '.claude/settings.json permissions.{list} erhält die Regel {rule} (weitreichend, durch --allow-broad-permissions erlaubt).',
  grantsPermission: '.claude/settings.json permissions.{list} erhält die Regel {rule}.',
  revokesPermission: '.claude/settings.json permissions.{list} verliert die Regel {rule}, die Forge geschrieben hat und die keine Definition mehr gewährt.',
  envTemplateLiteral: '{expression} bleibt wörtlich erhalten; Claude Code expandiert keine docker-agent-Umgebungsausdrücke in Agenten.',
  templateLiteral: '{expression} bleibt wörtlich erhalten; Claude Code kann keine docker-agent-Vorlagenausdrücke auswerten.',
  addDate: 'Claude Code fügt das aktuelle Datum selbst in seinen System-Prompt ein.',
  addEnvironment: 'Claude Code fügt Arbeitsverzeichnis, Plattform und Git-Informationen selbst in seinen System-Prompt ein.',
  promptFilesUnsupported: '{field} wird nicht ausgegeben; Claude Code lädt stattdessen CLAUDE.md-Dateien.',
  welcomeMessage: 'Claude-Agenten haben keine Willkommensnachricht.',
  externalSubAgent: 'Der externe Unteragent {agent} wird nicht generiert.',
  subAgentsApproximated: 'Unteragenten werden zu Agent(…)-Einträgen in tools, die Claude Code nur durchsetzt, wenn {agent} als Hauptthread läuft.',
  delegationUnsupported: '{field} wird nicht ausgegeben; Claude delegiert nur über das Werkzeug Agent.',
  skillsDiscovered: 'Claude Code findet Projekt- und Benutzer-Skills selbst.',
  skillsDisabled: 'Skills sind deaktiviert; Claude-Agenten können die Skill-Erkennung nicht abschalten.',
  inlineSkill: 'Der eingebettete Skill {skill} wird nicht generiert; schreiben Sie ihn als .claude/skills/{skill}/SKILL.md.',
  skillSource: 'Die Skill-Quelle {source} wird nicht ausgegeben; Claude Code lädt Skills aus .claude/skills.',
  namedSkills: 'Benannte Skills werden über das skills-Frontmatter vorgeladen; Claude Code löst sie nach Namen auf.',
  nameSanitized: 'Der Agent {name} wird als {claude} generiert.',
  agentDescription: 'Der Agent hat keine Beschreibung; "{description}" wird ausgegeben, damit Claude Code an ihn delegieren kann.',
  maxIterations: 'max_iterations wird als maxTurns: {turns} ausgegeben; Claude zählt agentische Runden, nicht Modellaufrufe.',
  settingUnsupported: '{field} hat keine Entsprechung in Claude-Agenten und wird nicht ausgegeben.',
  importAlias: 'Der Alias {alias} wird als anthropic/{model} importiert.',
  importOmittedModel: 'Ein fehlendes Modell wird als konfigurierter Standard {default} importiert.',
  importModel: 'Das Modell {model} wird als konfigurierter Standard {default} importiert.',
  serverReference: 'Die Serverreferenz {server} nennt einen außerhalb des Agenten konfigurierten Server; fügen Sie ihn als mcp-Toolset oder mcps-Definition hinzu.',
  transportUnsupported: 'Der Transport {type} hat keine docker-agent-Entsprechung; der Server wird nicht importiert.',
  toolsInherited: 'Der Claude-Agent erbt jedes Werkzeug; die Toolsets filesystem, shell, fetch, todo und user_prompt werden importiert.',
  fileToolsReadonly: 'Dateiwerkzeuge werden als schreibgeschütztes Toolset filesystem importiert.',
  fileTools: 'Dateiwerkzeuge werden als Toolset filesystem importiert.',
  taskTools: 'Aufgabenwerkzeuge werden als Toolset todo importiert.',
  askUser: 'AskUserQuestion wird als Toolset user_prompt importiert.',
  toolUnsupported: 'Das Claude-Werkzeug {tool} hat kein docker-agent-Toolset und wird nicht importiert.',
  disallowedUnsupported: 'Das Verbot von {tool} hat keine docker-agent-Entsprechung.',
  memoryImported: 'memory: {memory} wird als Toolset memory importiert.',
  importHookUnsupported: 'Das Hook-Ereignis {event} hat keine docker-agent-Entsprechung.',
  importHookApproximated: '{event}-Befehls-Hooks werden als {target} importiert; nur Befehls-Hooks bleiben erhalten, und docker-agent sendet seine eigene Hook-Eingabe.',
  importNameSanitized: 'Der Agent {name} wird als {imported} importiert.',
  generatedAgent: 'Dieser Agent wurde aus {source} generiert; bearbeiten Sie stattdessen diese Definition, da ein Import verlustbehaftet ist.',
  subAgentsImported: 'Agent(…)-Einträge werden zu sub_agents: {agents}.',
  subAgentMissing: 'Agent({agent}) wird nicht importiert, weil {agent} in der Zieldatei nicht definiert ist; importieren Sie ihn zuerst.',
  importFieldUnsupported: '{field} hat keine docker-agent-Entsprechung und wird nicht importiert.',
  unknownField: 'Das unbekannte Feld {field} wird nicht importiert.',
  maxTurnsImported: 'maxTurns wird als max_iterations importiert, das Modellaufrufe zählt.',
  skillsImported: 'Vorgeladene Skills werden als Skill-Namen importiert; docker-agent lädt sie bei Bedarf.',
  mcpServerConflict: '.mcp.json definiert bereits den Server {server}, den Forge nicht generiert hat; benennen Sie den Server des Toolsets um oder übergeben Sie --rename-conflicts.',
  mcpServerRenamed: '.mcp.json definiert bereits einen anderen Server {server}; dieser wird als {name} generiert.',
  commandsNotGenerated: 'Befehle werden mit --commands zu Claude-Skills.',
  topLevelUnsupported: 'Der oberste Abschnitt {key} hat keine Claude-Entsprechung und wird nicht ausgegeben.',
  permissionsNotGenerated: 'Berechtigungen werden mit --settings zu Regeln in den Projekteinstellungen.',
  commandLabel: '/{command} des Agenten {agent}',
  commandCollision: 'Der Befehl {label} würde .claude/skills/{name}/SKILL.md generieren, die bereits der Befehl {owner} generiert; benennen Sie einen der Befehle um.',
  commandRenamed: 'Mehrere Agenten definieren ein abweichendes /{command}; dieses wird zum Skill {name}.',
  agentCollision: 'Der Agent {name} würde .claude/agents/{claude}.md generieren, die bereits {owner} generiert.',
  agentDeviceName: 'Der Agent {name} würde {file} generieren, einen unter Windows reservierten Gerätenamen, den keine Datei unter Windows tragen kann; benennen Sie den Agenten um.',
  commandDeviceName: 'Der Befehl {label} würde {file} generieren, dessen Ordner einen unter Windows reservierten Gerätenamen trägt, den kein Ordner unter Windows tragen kann; benennen Sie den Befehl um.',
  mainAgent: 'Der Standardagent {agent} wird zum Hauptagenten des Projekts ("agent": "{claude}").',
  settingsAgentConflict: '.claude/settings.json setzt agent bereits auf {agent}, das Forge nicht generiert hat; entfernen Sie es, damit Forge {claude} setzen kann.',
  encoding: 'Definitionsdateien müssen gültiges UTF-8 sein.',
};

/** Whether a value is an agent diagnostic: a finding with a severity, a code, a JSON pointer and a message. */
const isDiagnostic = (value: Record<string, unknown>) => typeof value.severity === 'string' && typeof value.code === 'string' && typeof value.pointer === 'string' && typeof value.message === 'string';

/**
 * `value` with the message of every agent diagnostic inside it in the response language: in results and in the
 * details of a failure. Diagnostics that reproduce docker-agent's or a parser's own messages stay as written.
 */
export function localizedDiagnostics<T>(value: T, language: Language): T {
  if (language === 'en') return value;
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(walk);
    if (!isRecord(item)) return item;
    const entries = Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, walk(entry)]));
    return isDiagnostic(item) ? { ...entries, message: retranslate(item.message as string, agentMessages, germanAgentMessages, agentFragments) } : entries;
  };
  return walk(value) as T;
}

/** The `agents` command with the diagnostics of its results and failures in the response language. */
export function withLocalizedDiagnostics<Context extends CommandContext>(command: Command<Context>): Command<Context> {
  return {
    ...command,
    async run(args, flags, context) {
      try { return localizedDiagnostics(await command.run(args, flags, context), context.language); }
      catch (error) {
        const failure = error as Error & { details?: unknown };
        if (error instanceof Error && isRecord(failure.details)) failure.details = localizedDiagnostics(failure.details, context.language);
        throw error;
      }
    },
  };
}
