import { describe, expect, it } from 'vitest';
import { importClaudeAgent } from '../../src/plugins/agents/domain/claude-import.ts';
import { semanticDiagnostics } from '../../src/plugins/agents/domain/semantics.ts';
import { ajvDefinitionSchema } from '../../src/plugins/agents/infrastructure/schema.ts';

const codes = (diagnostics: Array<{ code: string; fidelity?: string }>) => diagnostics.map(entry => `${entry.code}:${entry.fidelity}`);
const defaultModel = 'anthropic/claude-sonnet-5';

describe('importing Claude agents into docker-agent definitions', () => {
  it('converts identity, model, tools, MCP servers, limits, skills and hooks into a valid agent', () => {
    const metadata = {
      name: 'code-reviewer', description: 'Reviews code.', model: 'claude-opus-5',
      tools: 'Read, Grep, Glob, Bash, WebFetch, TaskCreate, AskUserQuestion, WebSearch, Agent(helper), Agent(ghost), mcp__github__get_issue',
      mcpServers: [{ github: { type: 'stdio', command: 'npx', args: ['-y', 'server-github'], env: { TOKEN: '${GH}' } } }, { docs: { type: 'http', url: 'https://docs.example/mcp' } }, 'shared', { live: { type: 'ws', url: 'wss://x' } }],
      maxTurns: 12, skills: ['review'], memory: 'project', permissionMode: 'plan', color: 'blue', custom: 1,
      hooks: { PreToolUse: [{ matcher: 'Bash|Edit', hooks: [{ type: 'command', command: './guard.sh', timeout: 2.5 }, { type: 'prompt', prompt: 'x' }] }], CwdChanged: [{ hooks: [{ type: 'command', command: 'x' }] }] },
    };
    const imported = importClaudeAgent(metadata, 'Review carefully.\n', defaultModel, ['helper']);
    expect(imported.name).toBe('code-reviewer');
    expect(imported.agent).toEqual({
      model: 'anthropic/claude-opus-5', description: 'Reviews code.', instruction: 'Review carefully.\n', sub_agents: ['helper'],
      toolsets: [
        { type: 'filesystem', readonly: true }, { type: 'shell' }, { type: 'fetch' }, { type: 'todo' }, { type: 'user_prompt' }, { type: 'memory' },
        { type: 'mcp', name: 'github', command: 'npx', args: ['-y', 'server-github'], env: { TOKEN: '${GH}' }, tools: ['get_issue'] },
        { type: 'mcp', name: 'docs', remote: { url: 'https://docs.example/mcp', transport_type: 'streamable' } },
      ],
      skills: ['review'], max_iterations: 12,
      hooks: { pre_tool_use: [{ matcher: 'shell|edit_file', hooks: [{ type: 'command', command: './guard.sh', timeout: 3 }] }] },
    });
    expect(codes(imported.diagnostics)).toEqual(expect.arrayContaining([
      'toolset-approximated:A', 'tool-unsupported:U', 'mcp-reference-unsupported:U', 'mcp-transport-unsupported:U', 'delegation-approximated:A', 'delegation-unsupported:U',
      'hook-approximated:A', 'hook-unsupported:U', 'field-unsupported:U', 'max-iterations-approximated:A', 'skills-approximated:A',
    ]));
    const config = { agents: { helper: { model: 'auto' }, [imported.name]: imported.agent } };
    expect([...ajvDefinitionSchema.validate(config), ...semanticDiagnostics(config)]).toEqual([]);
  });

  it('approximates inherited tools and models, aliases and generated provenance', () => {
    const inherited = importClaudeAgent({ name: 'Helper Bot', description: 'Helps.', 'x-forge-source': { path: 'agents/team.yaml', sha256: 'a', agent: 'helper' } }, '', defaultModel, []);
    expect(inherited.name).toBe('Helper-Bot');
    expect(inherited.agent.model).toBe(defaultModel);
    expect((inherited.agent.toolsets as unknown[]).map(toolset => (toolset as { type: string }).type)).toEqual(['filesystem', 'shell', 'fetch', 'todo', 'user_prompt']);
    expect(codes(inherited.diagnostics)).toEqual(expect.arrayContaining(['name-sanitized:E', 'generated-agent:A', 'tools-inherited:A', 'model-approximated:A']));
    expect(importClaudeAgent({ name: 'a', description: 'd', model: 'haiku', tools: ['Read', 'Edit'] }, '', defaultModel, []).agent).toMatchObject({ model: 'anthropic/claude-haiku-4-5', toolsets: [{ type: 'filesystem' }] });
    expect(importClaudeAgent({ name: 'a', description: 'd', model: 'inherit', tools: 'Read, Edit', disallowedTools: 'Edit' }, '', defaultModel, []).agent).toMatchObject({ model: defaultModel, toolsets: [{ type: 'filesystem', readonly: true }] });
  });
});
