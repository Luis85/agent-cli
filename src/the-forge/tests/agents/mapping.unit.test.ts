import { describe, expect, it } from 'vitest';
import { generateClaude, type ClaudeGenerationOptions } from '../../src/plugins/agents/domain/claude-generation.ts';
import { claudeModel } from '../../src/plugins/agents/domain/claude-models.ts';
import { claudeTools, toolName } from '../../src/plugins/agents/domain/claude-tools.ts';
import { claudeHooks } from '../../src/plugins/agents/domain/claude-hooks.ts';
import { commandArguments, mcpVariables, templateExpressions } from '../../src/plugins/agents/domain/templating.ts';
import { claudeName, translateMatcher } from '../../src/plugins/agents/domain/claude-vocabulary.ts';

const options: ClaudeGenerationOptions = { mcp: 'inline', hooks: false, settings: false, commands: false, modelStyle: 'id' };
const source = (config: Record<string, unknown>) => ({ path: 'agents/team.yaml', sha256: 'a'.repeat(64), config, instructions: {} });
const generate = (config: Record<string, unknown>, extra: Partial<ClaudeGenerationOptions> = {}) => generateClaude([source(config)], { ...options, ...extra });
const agent = (extra: Record<string, unknown> = {}) => ({ model: 'anthropic/claude-sonnet-5', description: 'Helps.', instruction: 'Help.', ...extra });
const tools = (toolsets: unknown[], extra: Record<string, unknown> = {}) => claudeTools({ agents: { a: agent({ toolsets, ...extra }) } }, 'a', agent({ toolsets, ...extra }));
const codes = (diagnostics: Array<{ code: string; fidelity?: string }>) => diagnostics.map(entry => `${entry.code}:${entry.fidelity}`);

describe('agent identity and prompt', () => {
  it('sanitizes names, inlines instructions and records provenance', () => {
    const output = generate({ agents: { Code_Reviewer: agent({ instruction: ['First.', 'Second.'] }) } });
    expect(output.agents[0]).toMatchObject({ path: '.claude/agents/code-reviewer.md', body: 'First.\n\nSecond.\n', metadata: { name: 'code-reviewer', 'x-forge-source': { path: 'agents/team.yaml', sha256: 'a'.repeat(64), agent: 'Code_Reviewer' } } });
    expect(codes(output.diagnostics)).toContain('name-sanitized:E');
    expect(claudeName('--Weird  Name!!')).toBe('weird-name');
  });

  it('synthesizes a missing description, keeps templates literally and reports prompt options', () => {
    const output = generate({ agents: { a: { model: 'anthropic/x', instruction: 'Hi ${env.USER || "you"} ${shell({cmd: "ls"})}', add_date: true, add_environment_info: true, add_prompt_files: ['AGENTS.md'], welcome_message: 'Hello' } } });
    expect(output.agents[0]!.metadata.description).toBe('The a agent.');
    expect(output.agents[0]!.body).toBe('Hi ${env.USER || "you"} ${shell({cmd: "ls"})}\n');
    expect(codes(output.diagnostics)).toEqual(expect.arrayContaining(['description-synthesized:A', 'template-literal:A', 'template-literal:U', 'prompt-option-approximated:A', 'prompt-option-unsupported:U', 'tools-none:E']));
  });

  it('uses resolved instruction files', () => {
    const output = generateClaude([{ ...source({ agents: { a: { model: 'auto', description: 'd', instruction_file: 'p.md' } } }), instructions: { a: 'From file.' } }], options);
    expect(output.agents[0]!.body).toBe('From file.\n');
  });
});

describe('models', () => {
  const models = {
    sonnet: { provider: 'anthropic', model: 'claude-sonnet-5', thinking_budget: 'adaptive/xhigh', temperature: 0.2, base_url: 'https://x' },
    gpt: { provider: 'openai', model: 'gpt-5' },
    alloy: { model: 'gpt,sonnet' },
    pick: { first_available: ['openai/gpt-5', 'anthropic/claude-opus-5'] },
    corp: { provider: 'corp-claude', model: 'claude-haiku-4-5', thinking_budget: 20000 },
  };
  const config = { models, providers: { 'corp-claude': { provider: 'anthropic', base_url: 'https://proxy' } } };
  const model = (reference: string, style: 'id' | 'alias' = 'id', extra: Record<string, unknown> = {}) => claudeModel({ ...config, agents: {} }, 'a', { model: reference, ...extra }, style);

  it('maps inline and named Anthropic models exactly, as ids or aliases', () => {
    expect(model('anthropic/claude-opus-5')).toEqual({ model: 'claude-opus-5', diagnostics: [] });
    expect(model('anthropic/claude-opus-5', 'alias')).toMatchObject({ model: 'opus', diagnostics: [expect.objectContaining({ code: 'model-alias', fidelity: 'A' })] });
    const named = model('sonnet');
    expect(named).toMatchObject({ model: 'claude-sonnet-5', effort: 'xhigh' });
    expect(named.diagnostics.map(entry => [entry.code, entry.pointer])).toEqual([['effort-approximated', '/models/sonnet/thinking_budget'], ['model-setting-unsupported', '/models/sonnet/temperature'], ['model-setting-unsupported', '/models/sonnet/base_url']]);
    expect(model('corp')).toMatchObject({ model: 'claude-haiku-4-5', effort: 'high' });
  });

  it('approximates other providers, auto, alloys and first_available with the first Anthropic candidate or inherit', () => {
    for (const reference of ['gpt', 'auto', 'google/gemini-3', '']) expect(model(reference)).toMatchObject({ model: 'inherit', diagnostics: [expect.objectContaining({ code: 'model-approximated', fidelity: 'A' })] });
    expect(model('alloy')).toMatchObject({ model: 'claude-sonnet-5', diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'model-approximated' })]) });
    expect(model('pick')).toMatchObject({ model: 'claude-opus-5', diagnostics: [expect.objectContaining({ code: 'model-approximated' })] });
    expect(model('openai/gpt-5,anthropic/claude-haiku-4-5', 'alias')).toMatchObject({ model: 'haiku' });
  });

  it('takes model and effort from a claude-code harness and drops other harnesses', () => {
    expect(model('', 'id', { harness: { type: 'claude-code', model: 'claude-opus-5', effort: 'max' } })).toMatchObject({ model: 'claude-opus-5', effort: 'max', diagnostics: [expect.objectContaining({ code: 'harness-approximated' })] });
    expect(model('', 'id', { harness: { type: 'codex' } })).toMatchObject({ model: 'inherit', diagnostics: [expect.objectContaining({ code: 'harness-unsupported', fidelity: 'U' })] });
  });
});

describe('toolsets', () => {
  it('maps every built-in toolset type with an equivalent', () => {
    const mapped = tools([{ type: 'filesystem' }, { type: 'shell' }, { type: 'fetch' }, { type: 'todo' }, { type: 'tasks' }, { type: 'memory' }, { type: 'user_prompt' }, { type: 'think' }]);
    expect(mapped.tools).toEqual(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'AskUserQuestion']);
    expect(mapped.memory).toBe(true);
    expect(codes(mapped.diagnostics)).toEqual(Array(6).fill('toolset-approximated:A'));
  });

  it.each(['mcp_catalog', 'script', 'calculator', 'random', 'file', 'background_jobs', 'plan', 'session_context', 'api', 'a2a', 'lsp', 'openapi', 'open_url', 'model_picker', 'background_agents', 'scheduler', 'rag', 'git', 'webhook', 'environment', 'datetime'])('does not emit the %s toolset', type => {
    const mapped = tools([{ type }]);
    expect(mapped.tools).toEqual([]);
    expect(mapped.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'toolset-unsupported', fidelity: 'U', pointer: '/agents/a/toolsets/0' })]);
  });

  it('applies readonly and tool filters', () => {
    const readonly = tools([{ type: 'filesystem' }, { type: 'shell' }], { readonly: true });
    expect(readonly).toMatchObject({ tools: ['Read', 'Glob', 'Grep'], disallowedTools: ['Write', 'Edit', 'NotebookEdit'] });
    expect(tools([{ type: 'filesystem', tools: ['read_file', 'search_files_content'] }]).tools).toEqual(['Read', 'Grep']);
  });

  it('maps stdio, remote and Docker MCP servers with tool grants and Claude variables', () => {
    const mapped = tools([
      { type: 'mcp', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { TOKEN: '${env.GH_TOKEN}', MODE: "${env.MODE || 'ro'}", RAW: '${LEGACY}' }, tools: ['list_issues'] },
      { type: 'mcp', remote: { url: 'https://mcp.notion.com/mcp', transport_type: 'sse', headers: { Authorization: 'Bearer ${env.NOTION}' }, oauth: { clientId: 'id', callbackPort: 8080, scopes: ['read'] } } },
      { type: 'mcp', ref: 'docker:context7', config: { x: 1 } },
      { type: 'mcp', command: './server.sh', env: { X: '${env.A ? "b" : "c"}' } },
    ]);
    expect(mapped.servers).toEqual([
      { name: 'github', declared: 'github', at: '/agents/a/toolsets/0', commandLine: 'npx -y @modelcontextprotocol/server-github', config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { TOKEN: '${GH_TOKEN}', MODE: '${MODE:-ro}', RAW: '${LEGACY}' } } },
      { name: 'notion', declared: 'notion', at: '/agents/a/toolsets/1', config: { type: 'sse', url: 'https://mcp.notion.com/mcp', headers: { Authorization: 'Bearer ${NOTION}' }, oauth: { clientId: 'id', callbackPort: 8080 } } },
      { name: 'context7', declared: 'context7', at: '/agents/a/toolsets/2/ref', commandLine: 'docker mcp gateway run --servers context7', config: { type: 'stdio', command: 'docker', args: ['mcp', 'gateway', 'run', '--servers', 'context7'] } },
      { name: 'server', declared: 'server', at: '/agents/a/toolsets/3', commandLine: './server.sh', config: { type: 'stdio', command: './server.sh', env: { X: '${env.A ? "b" : "c"}' } } },
    ]);
    expect(mapped.tools.map(toolName)).toEqual(['mcp__github__list_issues', 'mcp__notion__*', 'mcp__context7__*', 'mcp__server__*']);
    expect(codes(mapped.diagnostics)).toEqual(['mcp-oauth-unsupported:U', 'toolset-field-unsupported:U', 'mcp-docker-gateway:A', 'template-literal:U']);
  });

  it('merges project MCP servers into one namespace and inlines them by default', () => {
    const config = { agents: {
      a: agent({ toolsets: [{ type: 'mcp', command: 'srv', name: 'tools' }] }),
      b: agent({ toolsets: [{ type: 'mcp', command: 'other', name: 'tools' }] }),
    } };
    const project = generate(config, { mcp: 'project' });
    expect(project.mcpServers).toEqual({ tools: { type: 'stdio', command: 'srv' }, 'tools-2': { type: 'stdio', command: 'other' } });
    expect(project.agents.map(entry => [entry.metadata.mcpServers, entry.metadata.tools])).toEqual([[['tools'], 'mcp__tools__*'], [['tools-2'], 'mcp__tools-2__*']]);
    expect(generate(config).agents[1]!.metadata.mcpServers).toEqual([{ tools: { type: 'stdio', command: 'other' } }]);
  });
});

describe('templating', () => {
  it('finds balanced expressions and converts MCP variables', () => {
    expect(templateExpressions('a ${x({y: "}"})} b ${env.Z}').map(entry => entry.body)).toEqual(['x({y: "}"})', 'env.Z']);
    expect(mcpVariables('${env.A}/${B}/${env.C || "d"}/${env.D ? 1 : 2}')).toEqual({ text: '${A}/${B}/${C:-d}/${env.D ? 1 : 2}', kept: ['${env.D ? 1 : 2}'] });
  });

  it('translates command arguments to skill placeholders', () => {
    expect(commandArguments('Fix ${args[0]} with ${args[1]}; all: ${args.join(" ")} ${args} ${env.X}')).toEqual({ text: 'Fix $0 with $1; all: $ARGUMENTS $ARGUMENTS ${env.X}', kept: ['${env.X}'], usesArguments: true });
    expect(commandArguments('No arguments').usesArguments).toBe(false);
  });
});

describe('commands, skills, hooks, permissions and delegation', () => {
  it('generates skills from commands only with --commands, drops URL commands and renames conflicts', () => {
    const config = { agents: {
      root: agent({ sub_agents: ['helper'], commands: { fix: 'Fix ${args[0]}', open: { url: 'https://x' }, go: { agent: 'helper', description: 'Switch' } } }),
      helper: agent({ commands: [{ fix: { description: 'Fix differently', instruction: 'Repair $ARGUMENTS ${tool({a: 1})}' } }] }),
    } };
    expect(generate(config).skills).toEqual([]);
    const output = generate(config, { commands: true });
    expect(output.skills.map(skill => [skill.path, skill.metadata.context, skill.metadata.agent, skill.body])).toEqual([
      ['.claude/skills/root-fix/SKILL.md', undefined, undefined, 'Fix $0\n'],
      ['.claude/skills/helper-fix/SKILL.md', undefined, undefined, 'Repair $ARGUMENTS ${tool({a: 1})}\n'],
      ['.claude/skills/go/SKILL.md', 'fork', 'helper', '$ARGUMENTS\n'],
    ]);
    expect(output.skills[0]!.metadata).toMatchObject({ description: 'Run the /fix command of the root agent.', 'disable-model-invocation': true, 'x-forge-source': { agent: 'root', command: 'fix' } });
    expect(codes(output.diagnostics)).toEqual(expect.arrayContaining(['command-unsupported:U', 'command-approximated:A', 'command-renamed:A', 'template-literal:U', 'description-synthesized:A']));
  });

  it('reports command names that collide after sanitizing as errors instead of generating duplicate skills', () => {
    const output = generate({ agents: { root: agent({ commands: { fix: 'Fix it.', Fix: 'Fix it differently.' } }) } }, { commands: true });
    expect(output.skills.map(skill => skill.path)).toEqual(['.claude/skills/root-fix/SKILL.md']);
    expect(output.diagnostics.filter(entry => entry.severity === 'error')).toEqual([expect.objectContaining({
      code: 'command-name-collision', pointer: '/agents/root/commands/Fix', path: 'agents/team.yaml', message: expect.stringContaining('which the /fix of root already generates'),
    })]);
  });

  it('maps hooks with Claude events and translated tool matchers', () => {
    const hooks = {
      pre_tool_use: [{ matcher: 'shell|edit_file|custom', hooks: [{ type: 'command', command: './guard.sh', timeout: 5, env: { A: 'b' } }, { type: 'builtin', command: 'redact_secrets' }] }],
      session_start: [{ type: 'command', command: 'echo start', args: ['x'] }],
      turn_start: [{ type: 'command', command: 'echo turn' }],
    };
    const mapped = claudeHooks('a', hooks);
    expect(mapped.hooks).toEqual({
      PreToolUse: [{ matcher: 'Bash|Edit|custom', hooks: [{ type: 'command', command: './guard.sh', timeout: 5 }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }],
    });
    expect(mapped.commands).toEqual([{ at: '/agents/a/hooks/pre_tool_use/0/hooks/0', event: 'PreToolUse', command: './guard.sh' }, { at: '/agents/a/hooks/session_start/0', event: 'SessionStart', command: 'echo start' }]);
    expect(codes(mapped.diagnostics)).toEqual(['hook-field-unsupported:U', 'hook-unsupported:U', 'hook-matcher-approximated:A', 'hook-approximated:A', 'hook-field-unsupported:U', 'hook-approximated:A', 'hook-unsupported:U']);
    expect(translateMatcher('*')).toEqual({ matcher: '*', unknown: [] });
  });

  it('maps delegation and the main agent into settings with --settings', () => {
    const config = { agents: { lead: agent(), root: agent({ sub_agents: ['lead', 'acme/remote'], handoffs: ['lead'] }) } };
    const output = generate(config, { settings: true });
    expect(output.settings).toEqual({ permissions: { allow: [], ask: [], deny: [] }, agent: 'root' });
    expect(output.agents[1]!.metadata.tools).toBe('Agent(lead)');
    expect(codes(output.diagnostics)).toEqual(expect.arrayContaining(['delegation-unsupported:U', 'delegation-approximated:A', 'main-agent-approximated:A']));
  });

  it('maps max_iterations, preloaded skills and reports unsupported settings and name collisions', () => {
    const output = generate({ metadata: { author: 'me' }, agents: { a: agent({ max_iterations: 7, skills: ['review', 'local', { name: 'x', description: 'd', instructions: 'i' }], cache: { enabled: true } }) } });
    expect(output.agents[0]!.metadata).toMatchObject({ maxTurns: 7, skills: ['review'] });
    expect(codes(output.diagnostics)).toEqual(expect.arrayContaining(['max-iterations-approximated:A', 'skills-approximated:A', 'skills-unsupported:U', 'setting-unsupported:U']));
    expect(generate({ agents: { a_b: agent(), 'a-b': agent() } }).diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'agent-name-collision' })]);
  });
});
