import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

/** The agents plugin's German manifest and option, argument and settings descriptions, available while it is disabled. */
export const agentsStrings: PluginStrings = {
  de: {
    manifest: { name: 'Agenten', description: 'docker-agent-Agentendefinitionen verwalten und daraus Claude-Code-Agenten generieren.' },
    descriptions: {
      'create and import: the team file to add to, directly in the definitions directory (team.yaml or agents/team.yaml); defaults to <name>.yaml with the sanitized agent name. generate: only this file.': 'create und import: die Team-Datei, der der Agent hinzugefügt wird, direkt im Definitionsverzeichnis (team.yaml oder agents/team.yaml); standardmäßig <name>.yaml mit dem bereinigten Agentennamen. generate: nur diese Datei.',
      'create: the model reference, such as anthropic/claude-sonnet-5 or a named model; defaults to plugins.settings.agents.defaultModel.': 'create: die Modellreferenz, etwa anthropic/claude-sonnet-5 oder ein benanntes Modell; standardmäßig plugins.settings.agents.defaultModel.',
      'create: the agent description.': 'create: die Beschreibung des Agenten.',
      'create: the agent instruction (system prompt); defaults to the description.': 'create: die Anweisung des Agenten (System-Prompt); standardmäßig die Beschreibung.',
      'create: comma-separated toolset types without required settings (filesystem, shell, fetch, think, todo, tasks, memory, user_prompt, calculator, random, datetime, environment, git, plan, session_context, background_jobs, background_agents, scheduler, mcp_catalog, file).': 'create: kommagetrennte Toolset-Typen ohne Pflichteinstellungen (filesystem, shell, fetch, think, todo, tasks, memory, user_prompt, calculator, random, datetime, environment, git, plan, session_context, background_jobs, background_agents, scheduler, mcp_catalog, file).',
      'create: start from a bundled template: basic (one read-only agent), team (a coordinator with <name>-researcher and <name>-writer sub-agents) or mcp (an agent with a Docker MCP Gateway server).': 'create: mit einer mitgelieferten Vorlage beginnen: basic (ein schreibgeschützter Agent), team (ein Koordinator mit den Unteragenten <name>-researcher und <name>-writer) oder mcp (ein Agent mit einem Docker-MCP-Gateway-Server).',
      'create and import: the current revision of an existing team file, required to add an agent to it.': 'create und import: die aktuelle Revision einer vorhandenen Team-Datei; erforderlich, um ihr einen Agenten hinzuzufügen.',
      'import: the agent format to convert from.': 'import: das Agentenformat, aus dem konvertiert wird.',
      'generate: the agent format to generate.': 'generate: das zu generierende Agentenformat.',
      'generate: only this docker-agent agent.': 'generate: nur diesen docker-agent-Agenten.',
      'generate: MCP servers start processes or reach remote services, so none are written by default; inline writes them in agent frontmatter, project merges them into the project .mcp.json.': 'generate: MCP-Server starten Prozesse oder erreichen entfernte Dienste, daher werden standardmäßig keine geschrieben; inline schreibt sie ins Frontmatter des Agenten, project führt sie in die .mcp.json des Projekts zusammen.',
      'generate: write agent hooks, which run commands; without it hooks are reported and skipped.': 'generate: Agenten-Hooks schreiben, die Befehle ausführen; ohne diese Option werden Hooks gemeldet und übersprungen.',
      'generate: merge permission rules and the main agent into .claude/settings.json; every rule is listed as a grants-permission diagnostic and every rule it removes as revokes-permission.': 'generate: Berechtigungsregeln und den Hauptagenten in .claude/settings.json zusammenführen; jede Regel wird als Diagnose grants-permission aufgeführt und jede entfernte Regel als revokes-permission.',
      'generate --mcp project: give a generated MCP server whose name .mcp.json already uses for a server Forge did not generate a numbered name, instead of failing with AGENT_MERGE_CONFLICT.': 'generate --mcp project: einem generierten MCP-Server, dessen Namen .mcp.json bereits für einen nicht von Forge generierten Server verwendet, einen nummerierten Namen geben, statt mit AGENT_MERGE_CONFLICT fehlzuschlagen.',
      'generate --settings: also write allow rules that approve a whole tool (Bash, Bash(*), Edit, Write, WebFetch without a domain, every tool of an MCP server); without it they fail as broad-permission errors.': 'generate --settings: auch allow-Regeln schreiben, die ein ganzes Werkzeug freigeben (Bash, Bash(*), Edit, Write, WebFetch ohne Domain, jedes Werkzeug eines MCP-Servers); ohne diese Option schlagen sie als broad-permission-Fehler fehl.',
      'generate: generate commands as .claude/skills/<name>/SKILL.md.': 'generate: Befehle als .claude/skills/<name>/SKILL.md generieren.',
      'generate: emit Anthropic model ids, or Claude aliases (opus, sonnet, haiku, fable).': 'generate: Anthropic-Modell-IDs oder Claude-Aliasse (opus, sonnet, haiku, fable) ausgeben.',
      'generate: JSON file mapping generated paths to approved SHA-256 revisions (from --plan-out).': 'generate: JSON-Datei, die generierte Pfade freigegebenen SHA-256-Revisionen zuordnet (aus --plan-out).',
      'generate: Report planned outputs and their status without writing.': 'generate: Geplante Ausgaben und ihren Status melden, ohne zu schreiben.',
      'generate: Write the plan\'s revision manifest to this path.': 'generate: Das Revisionsmanifest des Plans in diesen Pfad schreiben.',
      'generate: Fail with a drift code when outputs are missing or differ.': 'generate: Mit einem Abweichungscode fehlschlagen, wenn Ausgaben fehlen oder abweichen.',
      'list (default), inspect, validate, create, import or generate.': 'list (Standard), inspect, validate, create, import oder generate.',
      'inspect: file[#agent]; validate: file; create: the agent name; import: a Claude agent name or Markdown path.': 'inspect: Datei[#Agent]; validate: Datei; create: der Agentenname; import: ein Claude-Agentenname oder Markdown-Pfad.',
      'Scope-relative folder of docker-agent definition files (*.yaml).': 'Ordner der docker-agent-Definitionsdateien (*.yaml), relativ zum Geltungsbereich.',
      'Model reference for agents create and agents import when none is given.': 'Modellreferenz für agents create und agents import, wenn keine angegeben ist.',
    },
  },
};
