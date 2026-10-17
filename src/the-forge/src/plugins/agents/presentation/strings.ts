import type { PluginStrings } from '../../../application/plugins/plugin-catalog.ts';

/** The agents plugin's German manifest and option, argument and settings descriptions, available while it is disabled. */
export const agentsStrings: PluginStrings = {
  de: {
    manifest: { name: 'Agenten', description: 'docker-agent-Agentendefinitionen verwalten und daraus Claude-Code-Agenten generieren.' },
    descriptions: {
      'The team file to add to, directly in the definitions directory (team.yaml or agents/team.yaml); defaults to <name>.yaml with the sanitized agent name.': 'Die Team-Datei, der der Agent hinzugefügt wird, direkt im Definitionsverzeichnis (team.yaml oder agents/team.yaml); standardmäßig <name>.yaml mit dem bereinigten Agentennamen.',
      'Generate only from this definition file.': 'Nur aus dieser Definitionsdatei generieren.',
      'The model reference, such as anthropic/claude-sonnet-5 or a named model; defaults to plugins.settings.agents.defaultModel.': 'Die Modellreferenz, etwa anthropic/claude-sonnet-5 oder ein benanntes Modell; standardmäßig plugins.settings.agents.defaultModel.',
      'The agent description.': 'Die Beschreibung des Agenten.',
      'The agent instruction (system prompt); defaults to the description.': 'Die Anweisung des Agenten (System-Prompt); standardmäßig die Beschreibung.',
      'Comma-separated toolset types without required settings (filesystem, shell, fetch, think, todo, tasks, memory, user_prompt, calculator, random, datetime, environment, git, plan, session_context, background_jobs, background_agents, scheduler, mcp_catalog, file).': 'Kommagetrennte Toolset-Typen ohne Pflichteinstellungen (filesystem, shell, fetch, think, todo, tasks, memory, user_prompt, calculator, random, datetime, environment, git, plan, session_context, background_jobs, background_agents, scheduler, mcp_catalog, file).',
      'Start from a bundled template: basic (one read-only agent), team (a coordinator with <name>-researcher and <name>-writer sub-agents) or mcp (an agent with a Docker MCP Gateway server).': 'Mit einer mitgelieferten Vorlage beginnen: basic (ein schreibgeschützter Agent), team (ein Koordinator mit den Unteragenten <name>-researcher und <name>-writer) oder mcp (ein Agent mit einem Docker-MCP-Gateway-Server).',
      'The current revision of an existing team file, required to add an agent to it.': 'Die aktuelle Revision einer vorhandenen Team-Datei; erforderlich, um ihr einen Agenten hinzuzufügen.',
      'The agent format to convert from.': 'Das Agentenformat, aus dem konvertiert wird.',
      'The agent format to generate.': 'Das zu generierende Agentenformat.',
      'Only this docker-agent agent.': 'Nur diesen docker-agent-Agenten.',
      'MCP servers start processes or reach remote services, so none are written by default; inline writes them in agent frontmatter, project merges them into the project .mcp.json.': 'MCP-Server starten Prozesse oder erreichen entfernte Dienste, daher werden standardmäßig keine geschrieben; inline schreibt sie ins Frontmatter des Agenten, project führt sie in die .mcp.json des Projekts zusammen.',
      'Write agent hooks, which run commands; without it hooks are reported and skipped.': 'Agenten-Hooks schreiben, die Befehle ausführen; ohne diese Option werden Hooks gemeldet und übersprungen.',
      'Merge permission rules and the main agent into .claude/settings.json; every rule is listed as a grants-permission diagnostic and every rule it removes as revokes-permission.': 'Berechtigungsregeln und den Hauptagenten in .claude/settings.json zusammenführen; jede Regel wird als Diagnose grants-permission aufgeführt und jede entfernte Regel als revokes-permission.',
      'With --mcp project: give a generated MCP server whose name .mcp.json already uses for a server Forge did not generate a numbered name, instead of failing with AGENT_MERGE_CONFLICT.': 'Mit --mcp project: einem generierten MCP-Server, dessen Namen .mcp.json bereits für einen nicht von Forge generierten Server verwendet, einen nummerierten Namen geben, statt mit AGENT_MERGE_CONFLICT fehlzuschlagen.',
      'With --settings: also write allow rules that approve a whole tool (Bash, Bash(*), Edit, Write, WebFetch without a domain, every tool of an MCP server); without it they fail as broad-permission errors.': 'Mit --settings: auch allow-Regeln schreiben, die ein ganzes Werkzeug freigeben (Bash, Bash(*), Edit, Write, WebFetch ohne Domain, jedes Werkzeug eines MCP-Servers); ohne diese Option schlagen sie als broad-permission-Fehler fehl.',
      'Generate commands as .claude/skills/<name>/SKILL.md.': 'Befehle als .claude/skills/<name>/SKILL.md generieren.',
      'Emit Anthropic model ids, or Claude aliases (opus, sonnet, haiku, fable).': 'Anthropic-Modell-IDs oder Claude-Aliasse (opus, sonnet, haiku, fable) ausgeben.',
      'list (default), inspect, validate, create, import or generate.': 'list (Standard), inspect, validate, create, import oder generate.',
      'inspect: file[#agent]; validate: file; create: the agent name; import: a Claude agent name or Markdown path.': 'inspect: Datei[#Agent]; validate: Datei; create: der Agentenname; import: ein Claude-Agentenname oder Markdown-Pfad.',
      'Scope-relative folder of docker-agent definition files (*.yaml).': 'Ordner der docker-agent-Definitionsdateien (*.yaml), relativ zum Geltungsbereich.',
      'Model reference for agents create and agents import when none is given.': 'Modellreferenz für agents create und agents import, wenn keine angegeben ist.',
    },
  },
};
