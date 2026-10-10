import { describe, expect, it } from 'vitest';
import { validateClaudeAgent } from '../../src/domain/claude/agents.ts';
import { claudeAgentCodec } from '../../src/plugins/claude/infrastructure/agents.ts';
import { ObsidianDocuments } from '../../src/infrastructure/documents/codec.ts';

const { parse: parseClaudeAgent, render: renderClaudeAgent } = claudeAgentCodec(new ObsidianDocuments());

const metadata = { name: 'code-reviewer', description: 'Review changes for correctness.' };

describe('native Claude Code agent definitions', () => {
  it('preserves documented capabilities and unknown fields without injecting defaults', () => {
    const document = {
      metadata: {
        ...metadata, tools: 'Agent(worker, researcher), Read, mcp__github__*',
        disallowedTools: ['Write', 'Bash(git push *)'], model: 'claude-custom-model[1m]',
        permissionMode: 'auto', maxTurns: 12, skills: ['team-style', 'plugin:review'],
        memory: 'project', background: true, omitClaudeMd: true, effort: 'xhigh',
        isolation: 'worktree', color: 'cyan', initialPrompt: '/review changes',
        experimental: { cacheTtl: '1h', futureOption: { enabled: true } },
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo "$CLAUDE_PROJECT_DIR"' }] }] },
        mcpServers: [
          'github', { local: { command: 'node', args: ['server.js', ''], env: { TOKEN: '${TOKEN}' } } },
          { remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer ${TOKEN}' }, oauth: { clientId: 'client' } } },
          { events: { type: 'sse', url: 'https://example.test/sse' } },
          { socket: { type: 'ws', url: 'ws://localhost:8000' } },
        ],
        futureCapability: { enabled: false, data: [1, null, 'value'] },
      },
      prompt: '\n# Review\r\nKeep [[wikilinks]], `commands`, and $ARGUMENTS unchanged.\r\n\r\n---\r\n',
    };
    expect(parseClaudeAgent(renderClaudeAgent(document))).toEqual(document);
    expect(parseClaudeAgent(renderClaudeAgent({ metadata, prompt: '' }))).toEqual({ metadata, prompt: '' });
  });

  it('keeps comma-containing tool selectors intact and supports native list syntax', () => {
    const text = '---\nname: coordinator\ndescription: Coordinate work\ntools: Agent(worker, researcher), Read\ndisallowedTools: [Write, Edit]\n---\nPlan.';
    expect(parseClaudeAgent(text)).toEqual({
      metadata: { name: 'coordinator', description: 'Coordinate work', tools: 'Agent(worker, researcher), Read', disallowedTools: ['Write', 'Edit'] },
      prompt: 'Plan.',
    });
    expect(() => validateClaudeAgent({ ...metadata, tools: [], disallowedTools: [], skills: [] }, '')).not.toThrow();
  });

  it('accepts native names rather than imposing Forge generator naming rules', () => {
    for (const name of ['Explore', 'reviewer-v2', 'x'.repeat(256)]) expect(() => validateClaudeAgent({ ...metadata, name }, '')).not.toThrow();
  });

  it.each([
    { name: '' }, { name: '-reviewer' }, { name: 'plugin:reviewer' }, { name: 'x'.repeat(257) },
    { description: '' }, { description: false }, { tools: 42 }, { tools: ['Read', false] },
    { disallowedTools: {} }, { skills: 'style-guide' }, { maxTurns: 0 }, { maxTurns: 1.5 },
    { model: '' }, { permissionMode: 'acceptAll' }, { memory: 'global' }, { isolation: 'container' },
    { background: 'true' }, { omitClaudeMd: 1 }, { effort: 'extreme' }, { color: 'black' },
    { initialPrompt: [] }, { experimental: [] }, { experimental: { cacheTtl: '2h' } },
    { hooks: [] }, { mcpServers: {} }, { mcpServers: [''] }, { mcpServers: [{ server: {} }] },
    { mcpServers: [{ server: { type: 'http' } }] }, { mcpServers: [{ server: { command: 'node', args: [1] } }] },
    { mcpServers: [{ server: { command: 'node', env: { TOKEN: 42 } } }] },
  ])('rejects malformed native metadata: %j', invalid => {
    expect(() => validateClaudeAgent({ ...metadata, ...invalid }, 'Prompt')).toThrow(expect.objectContaining({ code: 'INVALID_CLAUDE_AGENT' }));
  });

  it.each([
    '# Not an agent\n',
    '\n---\nname: hidden\ndescription: Wrong position\n---\nPrompt',
    '---\ndescription: Missing name\n---\nPrompt',
    '---\nname: missing-description\n---\nPrompt',
    '---\nname: duplicate\nname: overwritten\ndescription: Invalid\n---\nPrompt',
    '---\nname: unclosed\ndescription: Invalid\n',
    '---\n- sequence\n---\nPrompt',
    '---\nname: cycle\ndescription: Invalid\ncycle: &cycle [*cycle]\n---\nPrompt',
  ])('reports invalid Markdown/frontmatter through the agent error contract', text => {
    expect(() => parseClaudeAgent(text)).toThrow(expect.objectContaining({ code: 'INVALID_CLAUDE_AGENT' }));
  });

  it('rejects nonportable metadata and invalid prompts before rendering', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const future of [cycle, Number.NaN, new Date(), () => undefined]) {
      expect(() => renderClaudeAgent({ metadata: { ...metadata, future }, prompt: 'Prompt' })).toThrow(expect.objectContaining({ code: 'INVALID_CLAUDE_AGENT' }));
    }
    expect(() => validateClaudeAgent(metadata, null)).toThrow(expect.objectContaining({ code: 'INVALID_CLAUDE_AGENT' }));
  });
});
