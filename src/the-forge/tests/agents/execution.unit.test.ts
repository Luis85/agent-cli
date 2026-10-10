import { describe, expect, it } from 'vitest';
import { generateClaude, type ClaudeGenerationOptions } from '../../src/plugins/agents/domain/claude-generation.ts';
import { noToolsDisallowed } from '../../src/plugins/agents/domain/claude-execution.ts';

/** Generated Claude artifacts that execute commands are written only on explicit opt-in, and always listed. */
const options: ClaudeGenerationOptions = { mcp: 'none', hooks: false, settings: false, commands: false, modelStyle: 'id' };
const agent = (extra: Record<string, unknown> = {}) => ({ model: 'anthropic/claude-sonnet-5', description: 'Helps.', instruction: 'Help.', ...extra });
const generate = (config: Record<string, unknown>, extra: Partial<ClaudeGenerationOptions> = {}) =>
  generateClaude([{ path: 'agents/team.yaml', sha256: 'a'.repeat(64), config, instructions: {} }], { ...options, ...extra });
const findings = (output: ReturnType<typeof generate>, code: string) => output.diagnostics.filter(entry => entry.code === code).map(({ severity, pointer, message }) => ({ severity, pointer, message }));

const mcpTeam = { agents: { root: agent({ toolsets: [
  { type: 'filesystem', readonly: true },
  { type: 'mcp', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github', '--label', 'two words'], tools: ['list_issues'] },
  { type: 'mcp', ref: 'docker:context7' },
  { type: 'mcp', remote: { url: 'https://mcp.notion.com/mcp' } },
] }) } };

describe('MCP servers', () => {
  it('writes no server and grants none of their tools by default, reporting each skipped server', () => {
    const output = generate(mcpTeam);
    expect(output.agents[0]!.metadata).toMatchObject({ tools: 'Read, Glob, Grep' });
    expect(output.agents[0]!.metadata.mcpServers).toBeUndefined();
    expect(output.mcpServers).toEqual({});
    expect(findings(output, 'mcp-not-generated')).toEqual([
      { severity: 'info', pointer: '/agents/root/toolsets/1', message: expect.stringContaining('github (npx -y @modelcontextprotocol/server-github --label "two words")') },
      { severity: 'info', pointer: '/agents/root/toolsets/2/ref', message: expect.stringContaining('context7 (docker mcp gateway run --servers context7)') },
      { severity: 'info', pointer: '/agents/root/toolsets/3', message: expect.stringContaining('notion (https://mcp.notion.com/mcp)') },
    ]);
    expect(findings(output, 'executes-command')).toEqual([]);
  });

  it.each(['inline', 'project'] as const)('lists every server command with --mcp %s', mcp => {
    const output = generate(mcpTeam, { mcp });
    expect(output.agents[0]!.metadata.tools).toBe('Read, Glob, Grep, mcp__github__list_issues, mcp__context7__*, mcp__notion__*');
    const target = mcp === 'inline' ? '.claude/agents/root.md' : '.mcp.json';
    expect(findings(output, 'executes-command')).toEqual([
      { severity: 'warning', pointer: '/agents/root/toolsets/1', message: `MCP server github in ${target} runs the command: npx -y @modelcontextprotocol/server-github --label "two words"` },
      { severity: 'warning', pointer: '/agents/root/toolsets/2/ref', message: `MCP server context7 in ${target} runs the command: docker mcp gateway run --servers context7` },
    ]);
    expect(Object.keys(mcp === 'inline' ? Object.assign({}, ...output.agents[0]!.metadata.mcpServers as object[]) : output.mcpServers)).toEqual(['github', 'context7', 'notion']);
  });
});

describe('hooks', () => {
  const hooked = { agents: { root: agent({ toolsets: [{ type: 'shell' }], hooks: {
    pre_tool_use: [{ matcher: 'shell', hooks: [{ type: 'command', command: './guard.sh --strict', args: ['ignored'] }] }],
    session_start: [{ type: 'command', command: 'echo "hello there"' }],
  } }) } };

  it('skips hooks without --hooks and names every skipped command', () => {
    const output = generate(hooked);
    expect(output.agents[0]!.metadata.hooks).toBeUndefined();
    expect(findings(output, 'hooks-not-generated')).toEqual([{ severity: 'info', pointer: '/agents/root/hooks', message: 'Hooks run commands and are generated only with --hooks; skipped PreToolUse: ./guard.sh --strict; SessionStart: echo "hello there".' }]);
  });

  it('writes command hooks without args with --hooks and lists each command', () => {
    const output = generate(hooked, { hooks: true });
    expect(output.agents[0]!.metadata.hooks).toEqual({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './guard.sh --strict' }] }], SessionStart: [{ hooks: [{ type: 'command', command: 'echo "hello there"' }] }] });
    expect(findings(output, 'executes-command')).toEqual([
      { severity: 'warning', pointer: '/agents/root/hooks/pre_tool_use/0/hooks/0', message: 'The PreToolUse hook of root runs the command: ./guard.sh --strict' },
      { severity: 'warning', pointer: '/agents/root/hooks/session_start/0', message: 'The SessionStart hook of root runs the command: echo "hello there"' },
    ]);
  });
});

describe('explicit tools', () => {
  it('gives an agent without toolsets no tools instead of inheriting every tool', () => {
    const output = generate({ agents: { quiet: agent(), readonly: agent({ readonly: true }) } });
    for (const generated of output.agents) {
      expect(generated.metadata.tools).toEqual([]);
      expect(String(generated.metadata.disallowedTools).split(', ')).toEqual(expect.arrayContaining([...noToolsDisallowed]));
    }
    expect(findings(output, 'tools-none').map(entry => entry.pointer)).toEqual(['/agents/quiet', '/agents/readonly']);
  });

  it('keeps sub-agent delegation as the only tool of a coordinator', () => {
    const output = generate({ agents: { root: agent({ sub_agents: ['helper'] }), helper: agent() } });
    expect(output.agents[0]!.metadata).toMatchObject({ tools: 'Agent(helper)' });
    expect(output.agents[0]!.metadata.disallowedTools).toBeUndefined();
  });

  it('gives no tools when every tool came from a skipped MCP server', () => {
    const output = generate({ agents: { root: agent({ toolsets: [{ type: 'mcp', command: 'srv' }] }) } });
    expect(output.agents[0]!.metadata.tools).toEqual([]);
  });
});
