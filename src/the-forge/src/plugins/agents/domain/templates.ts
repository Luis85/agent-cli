/** Bundled starting points for `agents create --from-template`, each a valid docker-agent configuration. */
export const agentTemplates = ['basic', 'team', 'mcp'] as const;
export type AgentTemplate = typeof agentTemplates[number];

/** The main agent's text: `--description` and `--instruction`, or the template's own. */
export interface TemplateText { description?: string; instruction?: string }

const text = (value: string) => `${value.trimEnd()}\n`;

/**
 * The agents a template adds, in declaration order; the first is the main agent named `name`, and helpers are named
 * `<name>-<role>`. Toolsets stay narrow: only `team`'s writer edits files and only `mcp` starts an MCP server (through
 * the Docker MCP Gateway), which `agents generate` writes only with `--mcp`.
 */
export function templateAgents(template: AgentTemplate, name: string, model: string, main: TemplateText): Array<[string, Record<string, unknown>]> {
  const agent = (description: string, instruction: string, toolsets: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
    ({ model, description: main.description ?? description, instruction: text(main.instruction ?? main.description ?? instruction), ...extra, toolsets });
  if (template === 'basic') {
    return [[name, agent(`The ${name} agent.`, 'Read the relevant files, think the task through, track your steps and report what you found.', [{ type: 'filesystem', readonly: true }, { type: 'think' }, { type: 'todo' }])]];
  }
  if (template === 'mcp') {
    return [[name, agent(`Searches the web for ${name} through an MCP server.`, 'Search the web with the DuckDuckGo tools, compare the sources and answer with links.', [{ type: 'mcp', ref: 'docker:duckduckgo' }, { type: 'think' }])]];
  }
  const researcher = `${name}-researcher`, writer = `${name}-writer`;
  return [
    [name, agent(`Coordinates the ${name} team.`, `Plan the work, delegate research to ${researcher} and writing to ${writer}, then review and summarize their results.`, [{ type: 'todo' }], { sub_agents: [researcher, writer] })],
    [researcher, { model, description: `Researches questions for ${name}.`, instruction: text('Research the question with web fetches, think it through and report findings with sources.'), toolsets: [{ type: 'fetch' }, { type: 'think' }] }],
    [writer, { model, description: `Writes and edits files for ${name}.`, instruction: text('Write and edit the requested files; keep changes small and report every file you changed.'), toolsets: [{ type: 'filesystem' }] }],
  ];
}
