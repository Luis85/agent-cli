import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentsWorkspace, example, type AgentsWorkspace } from './agents-workspace.ts';

let scope: AgentsWorkspace;
const generate = (flags: Record<string, string | boolean> = {}, options: { dryRun?: boolean } = {}) => scope.run(['generate'], { target: 'claude', ...flags }, options);
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a failure'); }, (error: unknown) => error as { code: string; message: string; details?: Record<string, unknown> });

beforeEach(async () => {
  scope = await agentsWorkspace();
  await scope.put('agents/team.yaml', await example('mcp-definitions.yaml'));
});
afterEach(async () => { await scope.dispose(); });

describe('generating Claude agents in a workspace', () => {
  it('previews, writes, then reports a clean check and emits agents.generated after commit', async () => {
    const preview = await generate({}, { dryRun: true });
    expect(preview.data).toMatchObject({ dryRun: true, files: [{ path: '.claude/agents/root.md', status: 'missing' }, { path: '.claude/agents/frontend.md', status: 'missing' }, { path: '.claude/agents/backend.md', status: 'missing' }] });
    expect(preview.events.some(event => event.id === 'agents.generated')).toBe(false);
    const written = await generate();
    expect(written.data).toMatchObject({ dryRun: false, agents: [{ agent: 'root', name: 'root', path: '.claude/agents/root.md', source: 'agents/team.yaml' }, expect.anything(), expect.anything()] });
    expect(written.events.filter(event => event.id.startsWith('vault.') || event.id.startsWith('agents.')).map(event => event.id)).toEqual(['vault.create', 'vault.create', 'vault.create', 'vault.create', 'vault.create', 'agents.generated']);
    expect(written.events.at(-1)!.payload).toEqual({ target: 'claude', sources: ['agents/team.yaml'], agents: ['root', 'frontend', 'backend'], files: ['.claude/agents/root.md', '.claude/agents/frontend.md', '.claude/agents/backend.md'] });
    expect(await scope.read('.claude/agents/frontend.md')).toContain('x-forge-source:\n  path: agents/team.yaml\n');
    expect((await generate({ check: true })).data).toMatchObject({ check: true, matches: true, stale: [] });
    expect((await generate()).data).toMatchObject({ changes: [] });
  });

  it('detects hand edits, source changes, missing and stale outputs, and regenerates only with approved revisions', async () => {
    await generate();
    const frontend = await scope.read('.claude/agents/frontend.md');
    await scope.put('.claude/agents/frontend.md', frontend.replace('You are a frontend engineer.', 'Hand edited.'));
    const drift = await failure(generate({ check: true }));
    expect(drift).toMatchObject({ code: 'AGENT_DRIFT', details: { outputs: [{ path: '.claude/agents/frontend.md', status: 'hand-edited' }], stale: [] } });

    const team = await scope.read('agents/team.yaml');
    await scope.put('agents/team.yaml', team.replace('You are a backend engineer.', 'You are the API engineer.').replace(/\n {2}frontend:[\s\S]*?(?=\n {2}backend:)/, '').replace('sub_agents: [frontend, backend]', 'sub_agents: [backend]'));
    await scope.put('.claude/agents/root.md', '');
    await scope.run(['validate']);
    const check = await failure(generate({ check: true }));
    expect(check.details).toEqual({ outputs: [{ path: '.claude/agents/root.md', status: 'hand-edited' }, { path: '.claude/agents/backend.md', status: 'changed' }], stale: ['.claude/agents/frontend.md'] });

    expect(await failure(generate())).toMatchObject({ code: 'CONFLICT' });
    const plan = await generate({ 'plan-out': 'review.json' });
    expect(plan.data).toMatchObject({ plan: true, matches: false, stale: ['.claude/agents/frontend.md'] });
    const regenerated = await generate({ 'revisions-from': 'review.json' });
    expect((regenerated.data.changes as Array<{ path: string; operation: string }>).map(change => [change.path, change.operation])).toEqual([['.claude/agents/root.md', 'updated'], ['.claude/agents/backend.md', 'updated']]);
    expect(await scope.read('.claude/agents/backend.md')).toContain('You are the API engineer.');
    expect(await failure(generate({ check: true }))).toMatchObject({ code: 'AGENT_DRIFT', details: { outputs: [], stale: ['.claude/agents/frontend.md'] } });
  });

  it('reports instruction file and option changes as changed, and only output edits as hand-edited', async () => {
    await scope.put('agents/team.yaml', 'agents:\n  root:\n    model: anthropic/claude-sonnet-5\n    description: Leads.\n    instruction_file: prompts/root.md\n');
    await scope.put('agents/prompts/root.md', 'Lead.\n');
    await generate();
    const written = await scope.read('.claude/agents/root.md');
    expect(written).toMatch(/x-forge-source:\n {2}path: agents\/team.yaml\n {2}agent: root\n {2}sourceHash: [a-f0-9]{64}\n {2}optionsHash: [a-f0-9]{64}\n {2}outputHash: [a-f0-9]{64}\n/);
    await scope.put('agents/prompts/root.md', 'Lead carefully.\n');
    expect(await failure(generate({ check: true }))).toMatchObject({ details: { outputs: [{ path: '.claude/agents/root.md', status: 'changed' }] } });
    await scope.put('agents/prompts/root.md', 'Lead.\n');
    expect((await generate({ check: true })).data).toMatchObject({ matches: true });
    expect(await failure(generate({ check: true, 'model-style': 'alias' }))).toMatchObject({ details: { outputs: [{ path: '.claude/agents/root.md', status: 'changed' }] } });
    expect(await failure(generate({ check: true, mcp: 'inline' }))).toMatchObject({ details: { outputs: [{ path: '.claude/agents/root.md', status: 'changed' }] } });
    await scope.put('.claude/agents/root.md', written.replace('Lead.', 'Lead, edited.'));
    await scope.put('agents/prompts/root.md', 'Lead carefully.\n');
    expect(await failure(generate({ check: true }))).toMatchObject({ details: { outputs: [{ path: '.claude/agents/root.md', status: 'hand-edited' }] } });
  });

  it('merges settings and skills into existing Claude files without clobbering unrelated keys', async () => {
    await scope.put('agents/switching.yaml', await example('agent_switching_commands.yaml'));
    await scope.put('.claude/settings.json', '{\n    "model": "opus",\n    "agent": "mine",\n    "permissions": {"deny": ["Read(.env)"]}\n}\n');
    expect(await failure(generate({ mcp: 'project', settings: true, commands: true }))).toMatchObject({ code: 'INVALID_AGENT_DEFINITION', details: { diagnostics: [expect.objectContaining({ code: 'agent-name-collision' })] } });
    expect(await failure(generate({ file: 'switching.yaml', settings: true }))).toMatchObject({ code: 'AGENT_MERGE_CONFLICT', details: { diagnostics: [expect.objectContaining({ code: 'settings-agent-conflict' })] } });
    await scope.put('.claude/settings.json', '{\n    "model": "opus",\n    "permissions": {"deny": ["Read(.env)"]}\n}\n');
    const result = await generate({ file: 'switching.yaml', settings: true, commands: true, 'plan-out': 'plan.json' });
    expect((result.data.files as Array<{ path: string; status: string }>).map(file => [file.path, file.status])).toEqual([
      ['.claude/agents/root.md', 'missing'], ['.claude/agents/planner.md', 'missing'], ['.claude/agents/reviewer.md', 'missing'],
      ['.claude/skills/plan/SKILL.md', 'missing'], ['.claude/skills/review/SKILL.md', 'missing'], ['.claude/skills/back/SKILL.md', 'missing'],
      ['.claude/settings.json', 'changed'], ['.claude/forge-generated.json', 'missing'],
    ]);
    await generate({ file: 'switching.yaml', settings: true, commands: true, 'revisions-from': 'plan.json' });
    expect(await scope.read('.claude/settings.json')).toBe('{\n    "model": "opus",\n    "permissions": {\n        "deny": [\n            "Read(.env)"\n        ]\n    },\n    "agent": "root"\n}\n');
    expect(JSON.parse(await scope.read('.claude/forge-generated.json'))).toMatchObject({ mcpServers: {}, settings: { agent: 'root' } });
    expect(await scope.read('.claude/skills/plan/SKILL.md')).toContain('context: fork\nagent: planner\n');
    expect((await generate({ file: 'switching.yaml', settings: true, commands: true, check: true })).data).toMatchObject({ matches: true });
  });

  it('merges MCP servers into .mcp.json, updating only servers Forge owns', async () => {
    await scope.put('.mcp.json', JSON.stringify({ mcpServers: { local: { command: 'mine' }, context7: { command: 'my-context7' } } }));
    const flags = { file: 'team.yaml', mcp: 'project', agent: 'frontend' };
    expect(await failure(generate(flags))).toMatchObject({ code: 'AGENT_MERGE_CONFLICT', details: { diagnostics: [expect.objectContaining({ code: 'mcp-server-conflict', pointer: '/agents/frontend/toolsets/2/ref' })] } });
    expect(await failure(generate({ 'rename-conflicts': true }))).toMatchObject({ code: 'INVALID_ARGUMENT' });
    const plan = await generate({ ...flags, 'rename-conflicts': true, 'plan-out': 'mcp.json' });
    expect((plan.data.files as Array<{ path: string }>).map(file => file.path)).toEqual(['.claude/agents/frontend.md', '.mcp.json', '.claude/forge-generated.json']);
    expect((plan.data.diagnostics as Array<{ code: string }>).map(entry => entry.code)).toContain('mcp-server-renamed');
    await generate({ ...flags, 'rename-conflicts': true, 'revisions-from': 'mcp.json' });
    const servers = JSON.parse(await scope.read('.mcp.json')).mcpServers;
    expect(Object.keys(servers)).toEqual(['local', 'context7', 'context7-2', 'github']);
    expect(servers.context7).toEqual({ command: 'my-context7' });
    expect(await scope.read('.claude/agents/frontend.md')).toContain('mcpServers:\n  - context7-2\n  - github\n');
    expect(await scope.read('.claude/agents/frontend.md')).toContain('mcp__context7-2__*');

    // A changed definition updates the server Forge wrote; a hand-edited one becomes the user's and conflicts.
    await scope.put('agents/team.yaml', (await scope.read('agents/team.yaml')).replace('ref: docker:github-official', 'ref: docker:github-enterprise'));
    await generate({ ...flags, 'rename-conflicts': true, 'plan-out': 'update.json' });
    await generate({ ...flags, 'rename-conflicts': true, 'revisions-from': 'update.json' });
    expect(JSON.parse(await scope.read('.mcp.json')).mcpServers.github.args).toContain('github-enterprise');
    const edited = JSON.parse(await scope.read('.mcp.json'));
    edited.mcpServers.github.args.push('--hand-edited');
    await scope.put('.mcp.json', JSON.stringify(edited));
    await scope.put('agents/team.yaml', (await scope.read('agents/team.yaml')).replace('ref: docker:github-enterprise', 'ref: docker:github-official'));
    expect(await failure(generate({ ...flags, 'rename-conflicts': true, check: true }))).toMatchObject({ code: 'AGENT_DRIFT' });
    const renamed = await generate({ ...flags, 'rename-conflicts': true, plan: true });
    expect((renamed.data.diagnostics as Array<{ code: string; message: string }>).filter(entry => entry.code === 'mcp-server-renamed').map(entry => entry.message)).toContain('.mcp.json already defines a different server github; this one is generated as github-2.');
  });

  it('refuses invalid definitions and unknown agents with coded errors', async () => {
    await scope.put('agents/broken.yaml', 'agents:\n  root:\n    model: nowhere\n    sub_agents: [ghost]\n');
    const invalid = await failure(generate());
    expect(invalid).toMatchObject({ code: 'INVALID_AGENT_DEFINITION', details: { files: [{ path: 'agents/broken.yaml', diagnostics: [
      expect.objectContaining({ code: 'unknown-model', pointer: '/agents/root/model', line: 3, column: 12 }),
      expect.objectContaining({ code: 'unknown-agent-reference', pointer: '/agents/root/sub_agents/0', line: 4, column: 18 }),
    ] }] } });
    expect(await failure(generate({ file: 'team.yaml', agent: 'nobody' }))).toMatchObject({ code: 'AGENT_NOT_FOUND' });
    expect(await failure(scope.run(['generate'], { target: 'claude', file: 'team.yaml', plan: true, check: true }))).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await failure(scope.run(['list'], { model: 'x' }))).toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('refuses broad allow rules unless --allow-broad-permissions is passed, and lists every written rule', async () => {
    await scope.put('agents/team.yaml', 'permissions:\n  allow: [shell, "shell:cmd=git status"]\nagents:\n  root:\n    model: auto\n    instruction: Hi.\n');
    const refused = await failure(generate({ settings: true, plan: true }));
    expect(refused).toMatchObject({ code: 'INVALID_AGENT_DEFINITION', message: expect.stringContaining('broad-permission'), details: { diagnostics: [expect.objectContaining({ code: 'broad-permission', pointer: '/permissions/allow/0' })] } });
    expect(await failure(generate({ 'allow-broad-permissions': true }))).toMatchObject({ code: 'INVALID_ARGUMENT' });
    const plan = await generate({ settings: true, 'allow-broad-permissions': true, plan: true });
    expect((plan.data.diagnostics as Array<{ code: string; message: string }>).filter(entry => entry.code === 'grants-permission').map(entry => entry.message)).toEqual([
      '.claude/settings.json permissions.allow gets the rule Bash (broad, allowed by --allow-broad-permissions).', '.claude/settings.json permissions.allow gets the rule Bash(git status).',
    ]);
  });
});
