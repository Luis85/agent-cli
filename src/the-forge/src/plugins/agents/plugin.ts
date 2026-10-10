import type { CorePlugin } from '../../application/plugins/core-plugins.ts';
import type { PluginContext } from '../../application/plugins/registry.ts';
import { isRecord } from '../../domain/shared/errors.ts';
import { AgentDefinitions } from './application/definitions.ts';
import { AgentAuthoring } from './application/authoring.ts';
import { AgentGeneration } from './application/generation.ts';
import type { AgentPorts } from './application/ports.ts';
import { yamlDefinitions } from './infrastructure/yaml-definitions.ts';
import { ajvDefinitionSchema } from './infrastructure/schema.ts';
import { markdownFrontmatter } from './infrastructure/frontmatter.ts';
import { sha256Digest } from './infrastructure/digest.ts';
import { agentsSkill } from './infrastructure/skill.ts';
import { agentsCommand } from './presentation/command.ts';

const defaults = { directory: 'agents', defaultModel: 'anthropic/claude-sonnet-5' };
const ports: AgentPorts = { codec: yamlDefinitions, schema: ajvDefinitionSchema, markdown: markdownFrontmatter, digest: sha256Digest };
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

/**
 * The `agents` core plugin: docker-agent agent definitions in `<scope>/agents/*.yaml`, validated against the
 * vendored docker-agent JSON Schema and semantic rules, and the Claude Code agents generated from them. Settings:
 * `plugins.settings.agents.directory` (definitions folder) and `defaultModel` (for `agents create` and imports).
 */
export const agentsPlugin: CorePlugin = {
  manifest: {
    id: 'agents', name: 'Agents', version: '0.1.0', minAppVersion: '0.1.0', core: true, author: 'The Forge',
    description: 'Manage docker-agent agent definitions and generate Claude Code agents from them.',
  },
  create: () => ({
    commands: [agentsCommand(context => {
      const settings = (context as PluginContext).settings ?? {};
      const directory = String(settings.directory ?? defaults.directory), defaultModel = String(settings.defaultModel ?? defaults.defaultModel);
      const definitions = new AgentDefinitions(context.workspace.files, ports, directory);
      const authoring = new AgentAuthoring(context.workspace, definitions, ports, defaultModel);
      const generation = new AgentGeneration(context.workspace, definitions, ports, context.events);
      return {
        list: () => definitions.list(), inspect: target => definitions.inspect(target), validate: file => definitions.validate(file),
        create: request => authoring.create(request), importClaude: (source, options) => authoring.importClaude(source, options),
        generate: request => generation.run(request),
      };
    })],
    events: [{
      id: 'agents.generated',
      description: 'Claude Code files were generated from agent definitions: {target, sources, agents, files}.',
      validate: (payload): payload is { target: string; sources: string[]; agents: string[]; files: string[] } =>
        isRecord(payload) && payload.target === 'claude' && strings(payload.sources) && strings(payload.agents) && strings(payload.files),
    }],
    skills: [agentsSkill],
    settings: {
      type: 'object', additionalProperties: false,
      properties: {
        directory: { type: 'string', minLength: 1, default: defaults.directory, description: 'Scope-relative folder of docker-agent definition files (*.yaml).' },
        defaultModel: { type: 'string', minLength: 1, default: defaults.defaultModel, description: 'Model reference for agents create and agents import when none is given.' },
      },
    },
    errors: [
      { code: 'INVALID_AGENT_DEFINITION', category: 'input', summary: 'An agent definition fails docker-agent schema or semantic validation.', hint: 'Fix each error in details.files[].diagnostics (JSON pointer, line and column), then run agents validate.' },
      { code: 'AGENT_NOT_FOUND', category: 'not-found', summary: 'No definition file defines the named agent.', hint: 'Run agents list for the defined agents, or create it with agents create.' },
      { code: 'AGENT_EXISTS', category: 'conflict', summary: 'The team file already defines an agent with this name.', hint: 'Choose another name or file, or edit the existing agent in the YAML file.' },
      { code: 'AGENT_MERGE_CONFLICT', category: 'conflict', summary: 'Generation would replace an MCP server or main agent in the project\'s Claude files that Forge did not write.', hint: 'Rename the generated MCP server in the definition, pass --rename-conflicts with --mcp project, or remove the entry; Forge only replaces entries recorded in .claude/forge-generated.json.' },
      { code: 'AGENT_DRIFT', category: 'drift', summary: 'Generated Claude files are missing, stale or differ from their agent definitions.', hint: 'Run agents generate with the same options and --plan-out review.json, review the outputs, then regenerate with --revisions-from review.json.' },
    ],
    strings: {
      de: {
        commands: { agents: 'docker-agent-Definitionen verwalten (auflisten, prüfen, validieren, anlegen, importieren) und daraus Claude-Code-Agenten generieren.' },
        events: { 'agents.generated': 'Claude-Code-Dateien wurden aus Agentendefinitionen generiert: {target, sources, agents, files}.' },
        errors: {
          INVALID_AGENT_DEFINITION: { summary: 'Eine Agentendefinition verletzt das docker-agent-Schema oder dessen semantische Regeln.', hint: 'Beheben Sie jeden Fehler in details.files[].diagnostics (JSON-Pointer, Zeile und Spalte) und führen Sie dann agents validate aus.' },
          AGENT_NOT_FOUND: { summary: 'Keine Definitionsdatei definiert den genannten Agenten.', hint: 'Führen Sie agents list für die definierten Agenten aus oder legen Sie ihn mit agents create an.' },
          AGENT_EXISTS: { summary: 'Die Team-Datei definiert bereits einen Agenten mit diesem Namen.', hint: 'Wählen Sie einen anderen Namen oder eine andere Datei oder bearbeiten Sie den vorhandenen Agenten in der YAML-Datei.' },
          AGENT_MERGE_CONFLICT: { summary: 'Die Generierung würde einen MCP-Server oder Hauptagenten in den Claude-Dateien des Projekts ersetzen, den Forge nicht geschrieben hat.', hint: 'Benennen Sie den generierten MCP-Server in der Definition um, übergeben Sie --rename-conflicts mit --mcp project oder entfernen Sie den Eintrag; Forge ersetzt nur Einträge, die in .claude/forge-generated.json verzeichnet sind.' },
          AGENT_DRIFT: { summary: 'Generierte Claude-Dateien fehlen, sind veraltet oder weichen von ihren Agentendefinitionen ab.', hint: 'Führen Sie agents generate mit denselben Optionen und --plan-out review.json aus, prüfen Sie die Ausgaben und generieren Sie dann mit --revisions-from review.json neu.' },
        },
      },
    },
  }),
};
