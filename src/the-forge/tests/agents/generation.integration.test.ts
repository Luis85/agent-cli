import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentsWorkspace, example, type AgentsWorkspace } from './agents-workspace.ts';

let scope: AgentsWorkspace;
const generate = (flags: Record<string, string | boolean> = {}, options: { dryRun?: boolean } = {}) => scope.run(['generate'], { target: 'claude', ...flags }, options);
/** Once the settings file exists, every generation is reviewed: plan, then write the planned revisions. */
async function reviewed(flags: Record<string, string | boolean>) {
  await scope.put('review.json', JSON.stringify((await generate({ ...flags, plan: true })).data.revisions));
  return generate({ ...flags, 'revisions-from': 'review.json' });
}
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

  it('removes the permission rules it granted once a definition stops granting them, keeping user rules', async () => {
    const team = (deny: string) => `agents:\n  root:\n    model: anthropic/claude-sonnet-5\n    description: Lead.\n    instruction: Lead.\npermissions:\n  allow:\n    - "shell:cmd=git *"\n  deny:\n${deny}`;
    await scope.put('agents/guarded.yaml', team('    - "shell:cmd=*sudo*"\n    - "shell:cmd=*rm -rf*"\n'));
    await scope.put('.claude/settings.json', '{\n  "permissions": {"allow": ["Bash(git *)"], "deny": ["Read(.env)"]}\n}\n');
    const guarded = { file: 'guarded.yaml', settings: true }, origins = [{ file: 'agents/guarded.yaml' }];
    await reviewed(guarded);
    expect(JSON.parse(await scope.read('.claude/settings.json')).permissions).toEqual({ allow: ['Bash(git *)'], deny: ['Read(.env)', 'Bash(*sudo*)', 'Bash(*rm -rf*)'] });
    expect(JSON.parse(await scope.read('.claude/forge-generated.json')).settings).toEqual({ agent: 'root', permissions: { deny: [{ rule: 'Bash(*sudo*)', origins }, { rule: 'Bash(*rm -rf*)', origins }] } });

    await scope.put('agents/guarded.yaml', team('    - "shell:cmd=*sudo*"\n'));
    expect((await reviewed(guarded)).data.diagnostics).toEqual(expect.arrayContaining([{ severity: 'warning', code: 'revokes-permission', pointer: '/permissions/deny', path: 'agents/guarded.yaml',
      message: '.claude/settings.json permissions.deny loses the rule Bash(*rm -rf*), which Forge wrote and no definition grants any more.' }]));
    expect(JSON.parse(await scope.read('.claude/settings.json')).permissions).toEqual({ allow: ['Bash(git *)'], deny: ['Read(.env)', 'Bash(*sudo*)'] });
    expect(JSON.parse(await scope.read('.claude/forge-generated.json')).settings).toEqual({ agent: 'root', permissions: { deny: [{ rule: 'Bash(*sudo*)', origins }] } });
  });

  it('removes only the rules whose every origin a --file or --agent generation covers', async () => {
    const agent = (name: string, denied?: string) => `  ${name}:\n    model: anthropic/claude-sonnet-5\n    description: ${name}.\n    instruction: ${name}.\n${denied ? `    toolsets:\n      - type: filesystem\n        deny_list: [${denied}]\n` : ''}`;
    const team = (agents: string, deny: string) => `agents:\n${agents}permissions:\n  deny:\n    - "${deny}"\n`;
    await scope.remove('agents/team.yaml');
    await scope.put('agents/a.yaml', team(agent('alpha', 'secrets') + agent('gamma'), 'shell:cmd=*sudo*'));
    await scope.put('agents/b.yaml', team(agent('beta'), 'shell:cmd=*rm -rf*'));
    await generate({ settings: true });
    const deny = async () => JSON.parse(await scope.read('.claude/settings.json')).permissions.deny as string[];
    const all = await deny();
    expect(all).toEqual(expect.arrayContaining(['Bash(*sudo*)', 'Bash(*rm -rf*)']));
    expect(all.filter(rule => rule.includes('secrets'))).not.toEqual([]);
    const revoked = (result: { data: Record<string, unknown> }) => (result.data.diagnostics as Array<{ code: string; pointer: string; path: string }>)
      .filter(entry => entry.code === 'revokes-permission').map(entry => `${entry.path}${entry.pointer}`);
    // One file, then one agent of it: the rules other definitions grant keep their origins and stay.
    for (const flags of [{ file: 'a.yaml' }, { agent: 'gamma' }] as Array<Record<string, string>>) {
      expect(revoked(await reviewed({ settings: true, ...flags })), JSON.stringify(flags)).toEqual([]);
      expect(await deny()).toEqual(all);
    }
    await scope.put('agents/a.yaml', team(agent('alpha') + agent('gamma'), 'shell:cmd=*sudo*'));
    const narrowed = await reviewed({ settings: true, agent: 'alpha' });
    expect(new Set(revoked(narrowed))).toEqual(new Set(['agents/a.yaml/agents/alpha']));
    expect(await deny()).toEqual(['Bash(*sudo*)', 'Bash(*rm -rf*)']);
  });

  it('revokes the rules of a renamed or deleted definition file in every --file run, and --check reports them', async () => {
    const team = (name: string, list: string, rule: string) => `agents:\n  ${name}:\n    model: anthropic/claude-sonnet-5\n    description: Lead.\n    instruction: Lead.\npermissions:\n  ${list}:\n    - "${rule}"\n`;
    const permissions = async () => JSON.parse(await scope.read('.claude/settings.json')).permissions as Record<string, string[]>;
    const revoked = (result: { data: Record<string, unknown> }) => (result.data.diagnostics as Array<{ code: string; path: string; message: string }>)
      .filter(entry => entry.code === 'revokes-permission').map(entry => `${entry.path}: ${entry.message}`);
    const loses = (rule: string) => `.claude/settings.json permissions.allow loses the rule ${rule}, which Forge wrote and no definition grants any more.`;
    await scope.remove('agents/team.yaml');
    await scope.put('agents/a.yaml', team('alpha', 'allow', 'shell:cmd=npm test'));
    await scope.put('agents/b.yaml', team('beta', 'deny', 'shell:cmd=*rm -rf*'));
    await generate({ settings: true });
    // A one-file run makes its default agent the main agent, so the filtered check below sees only the stale rule.
    expect(revoked(await reviewed({ settings: true, file: 'b.yaml' }))).toEqual([]);
    expect((await generate({ settings: true, file: 'b.yaml', check: true })).data).toMatchObject({ matches: true });

    // Deleted: a run over another file revokes the rule only the deleted file granted, and a filtered check sees it.
    await scope.remove('agents/a.yaml');
    expect(await failure(generate({ settings: true, file: 'b.yaml', check: true }))).toMatchObject({ code: 'AGENT_DRIFT', details: { outputs: expect.arrayContaining([{ path: '.claude/settings.json', status: 'changed' }]) } });
    expect(revoked(await reviewed({ settings: true, file: 'b.yaml' }))).toEqual([`agents/a.yaml: ${loses('Bash(npm test)')}`]);
    expect(await permissions()).toEqual({ deny: ['Bash(*rm -rf*)'] });
    expect((await generate({ settings: true, file: 'b.yaml', check: true })).data).toMatchObject({ matches: true });

    // Renamed: the old file's origin goes with the first run over the new name, so dropping the grant there revokes it.
    await scope.put('agents/a.yaml', team('alpha', 'allow', 'shell:cmd=npm test'));
    await reviewed({ settings: true, file: 'a.yaml' });
    await scope.put('agents/c.yaml', await scope.read('agents/a.yaml'));
    await scope.remove('agents/a.yaml');
    expect(revoked(await reviewed({ settings: true, file: 'c.yaml' }))).toEqual([]);
    expect(JSON.parse(await scope.read('.claude/forge-generated.json')).settings.permissions.allow).toEqual([{ rule: 'Bash(npm test)', origins: [{ file: 'agents/c.yaml' }] }]);
    await scope.put('agents/c.yaml', team('alpha', 'allow', 'shell:cmd=npm run lint'));
    expect(revoked(await reviewed({ settings: true, file: 'c.yaml' }))).toEqual([`agents/c.yaml: ${loses('Bash(npm test)')}`]);
    expect((await permissions()).allow).toEqual(['Bash(npm run lint)']);
  });

  it('keeps the rules of a definition file outside the definitions directory while it exists, and revokes them once it is gone', async () => {
    const team = (name: string, list: string, rule: string) => `agents:\n  ${name}:\n    model: anthropic/claude-sonnet-5\n    description: Lead.\n    instruction: Lead.\npermissions:\n  ${list}:\n    - "${rule}"\n`;
    const permissions = async () => JSON.parse(await scope.read('.claude/settings.json')).permissions as Record<string, string[]>;
    const revoked = (result: { data: Record<string, unknown> }) => (result.data.diagnostics as Array<{ code: string; path: string }>)
      .filter(entry => entry.code === 'revokes-permission').map(entry => entry.path);
    await scope.remove('agents/team.yaml');
    await scope.put('shared/guard.yaml', team('guard', 'deny', 'shell:cmd=*rm -rf*'));
    await scope.put('agents/a.yaml', team('alpha', 'allow', 'shell:cmd=npm test'));
    await generate({ settings: true, file: 'shared/guard.yaml' });
    expect(revoked(await reviewed({ settings: true, file: 'a.yaml' }))).toEqual([]);
    expect(await permissions()).toEqual({ deny: ['Bash(*rm -rf*)'], allow: ['Bash(npm test)'] });

    // Renamed outside the directory: the old path is gone, so a run over another file revokes its rule.
    await scope.put('shared/guard2.yaml', await scope.read('shared/guard.yaml'));
    await scope.remove('shared/guard.yaml');
    expect(revoked(await reviewed({ settings: true, file: 'a.yaml' }))).toEqual(['shared/guard.yaml']);
    expect(await permissions()).toEqual({ allow: ['Bash(npm test)'] });
    await reviewed({ settings: true, file: 'shared/guard2.yaml' });
    expect(await permissions()).toEqual({ allow: ['Bash(npm test)'], deny: ['Bash(*rm -rf*)'] });

    // Deleted outside the directory: revoked by the next run, as for a file in it.
    await scope.remove('shared/guard2.yaml');
    expect(revoked(await reviewed({ settings: true, file: 'a.yaml' }))).toEqual(['shared/guard2.yaml']);
    expect(await permissions()).toEqual({ allow: ['Bash(npm test)'] });
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
