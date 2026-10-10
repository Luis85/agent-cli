/** The showcase's docker-agent team and the Claude Code agents generated from it with the `agents` core plugin. */
export const agentTeam = {
  file: 'agents/trailhead-team.yaml',
  generate: ['agents', 'generate', '--target', 'claude', '--commands'],
};

// The lead and the spec writer are authored as YAML with comments; the UI builder is added with agents create.
const teamYaml = `# Trailhead delivery team in docker-agent format (https://github.com/docker/docker-agent).
# The Forge validates this file and generates the Claude Code agents in .claude/agents from it.
models:
  claude:
    provider: anthropic
    model: claude-sonnet-5
    thinking_budget: medium # becomes effort: medium

agents:
  trailhead-lead:
    model: claude
    description: Leads Trailhead changes from a REQ ID to a reviewed pull request and delegates specs and UI work.
    instruction: |
      You lead changes to the Trailhead trip planner.

      1. Start at docs/Trailhead.md and the PRD; name the REQ IDs a change touches.
      2. Delegate requirement and use-case updates to spec-writer, and component work to ui-builder.
      3. Regenerate generated code with the Forge CLI instead of editing it by hand.
    sub_agents: [spec-writer]
    toolsets:
      - type: filesystem
      - type: todo
      # GitHub issues and pull requests through the official MCP server.
      - type: mcp
        name: github
        command: npx
        args: ["-y", "@modelcontextprotocol/server-github"]
        env:
          GITHUB_PERSONAL_ACCESS_TOKEN: \${env.GITHUB_TOKEN}
        tools: [list_issues, get_issue, create_pull_request]
    commands:
      trace:
        description: Trace one requirement through specs, design, code and tests
        instruction: |
          Trace \${args[0]} from the PRD through use cases, design, build spec, implementation tasks and the verification plan.
          Report every missing link as a file path with the missing reference.

  spec-writer:
    model: anthropic/claude-haiku-4-5
    description: Writes and links Trailhead requirements, use cases and delivery notes in the Obsidian vault.
    instruction: |
      You maintain Trailhead's Markdown specs under docs/.
      Keep every REQ ID linked from the PRD, use wikilinks between notes, and never rename a note by copying it.
    toolsets:
      - type: filesystem
`;

const uiBuilder = {
  description: 'Builds Trailhead UI components from library definitions and keeps generated targets in sync.',
  instruction: 'You change component and interaction definitions under library/ and regenerate ui/ with the Forge CLI. Never edit generated framework files.',
};

/**
 * Authors the team, completes it with `agents create`, validates it and generates the Claude agents (with the
 * `trace` command as a skill), then checks them for drift. Returns the generation result for the README.
 * @param {import('./cli.mjs').ForgeCli} cli
 */
export function buildAgents(cli) {
  cli.begin('Agent definitions');
  cli.create(agentTeam.file, teamYaml);
  cli.guarded(agentTeam.file, ['agents', 'create', 'ui-builder', '--file', 'trailhead-team.yaml', '--model', 'anthropic/claude-haiku-4-5',
    '--description', uiBuilder.description, '--instruction', uiBuilder.instruction, '--toolset', 'filesystem,shell']);
  cli.guarded(agentTeam.file, ['edit', agentTeam.file, '--find', 'sub_agents: [spec-writer]', '--replace', 'sub_agents: [spec-writer, ui-builder]']);
  cli.run(['agents', 'validate']);
  cli.run(['agents', 'list']);
  cli.run([...agentTeam.generate, '--plan']);
  const generated = cli.run(agentTeam.generate).data;
  cli.run([...agentTeam.generate, '--check']);
  cli.run(['claude', 'agents', 'inspect', 'trailhead-lead']);
  return generated;
}

/**
 * The README section for the team: generated files and the mapping diagnostics, counted by code.
 * @param {{ agents: { agent: string, path: string }[], skills: string[], diagnostics: { severity: string, code: string, fidelity?: string }[] }} generated
 */
export function agentsSection(generated) {
  /** @type {Map<string, { count: number, severity: string, fidelity: string }>} */
  const codes = new Map();
  for (const entry of generated.diagnostics) {
    const current = codes.get(entry.code) ?? { count: 0, severity: entry.severity, fidelity: entry.fidelity ?? '' };
    codes.set(entry.code, { ...current, count: current.count + 1 });
  }
  return [
    '## Agent definitions',
    '',
    `The team in \`${agentTeam.file}\` is docker-agent YAML: \`trailhead-lead\` delegates to \`spec-writer\` and \`ui-builder\`, uses a GitHub MCP server and defines a \`/trace\` command. The \`agents\` core plugin validated it against docker-agent's schema and rules and generated the Claude Code files:`,
    '',
    '```sh',
    `node bin/forge.js ${agentTeam.generate.join(' ')}`,
    '```',
    '',
    ...generated.agents.map(agent => `- \`${agent.path}\` from \`${agent.agent}\``),
    ...generated.skills.map(path => `- \`${path}\` from the \`/trace\` command`),
    '',
    'Each generated file records `x-forge-source` provenance, so `--check` reports drift and hand edits. The mapping reported these diagnostics:',
    '',
    '| Code | Severity | Fidelity | Count |',
    '| --- | --- | --- | --- |',
    ...[...codes].map(([code, entry]) => `| \`${code}\` | ${entry.severity} | ${entry.fidelity} | ${entry.count} |`),
    '',
  ].join('\n');
}
