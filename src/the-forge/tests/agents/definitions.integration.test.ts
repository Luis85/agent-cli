import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentsWorkspace, example, type AgentsWorkspace } from './agents-workspace.ts';

let scope: AgentsWorkspace;
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a failure'); }, (error: unknown) => error as { code: string; details?: Record<string, unknown> });

beforeEach(async () => { scope = await agentsWorkspace(); });
afterEach(async () => { await scope.dispose(); });

describe('listing, inspecting and validating definitions', () => {
  it('lists files with agents, defaults and diagnostics, and inspects files and single agents', async () => {
    await scope.put('agents/dev-team.yaml', await example('dev-team.yaml'));
    await scope.put('agents/writing.yaml', await example('instruction_file.yaml'));
    await scope.put('agents/instructions/coordinator.md', 'Coordinate.\n');
    await scope.put('agents/instructions/shared-preamble.md', 'Be kind.\n');
    await scope.put('agents/instructions/writer.md', 'Write.\n');
    await scope.put('agents/nested/ignored.yaml', 'not: listed\n');
    const list = (await scope.run([])).data as { directory: string; files: Array<Record<string, unknown>> };
    expect(list.directory).toBe('agents');
    expect(list.files.map(file => [file.path, file.default, (file.agents as Array<{ name: string }>).map(agent => agent.name), file.valid])).toEqual([
      ['agents/dev-team.yaml', 'root', ['root', 'designer', 'awesome_engineer'], true],
      ['agents/writing.yaml', 'coordinator', ['coordinator', 'writer'], true],
    ]);
    expect((await scope.run(['inspect', 'writing.yaml#writer'])).data).toMatchObject({ path: 'agents/writing.yaml', agent: 'writer', default: false, instruction: 'Be kind.\n\n\nWrite.\n', diagnostics: [] });
    expect((await scope.run(['inspect', 'agents/dev-team.yaml'])).data).toMatchObject({ valid: true, default: 'root', config: { models: { model: { provider: 'anthropic' } } } });
    expect(await failure(scope.run(['inspect', 'dev-team.yaml#nobody']))).toMatchObject({ code: 'AGENT_NOT_FOUND', details: { agents: ['root', 'designer', 'awesome_engineer'] } });
    expect(await failure(scope.run(['inspect', 'missing.yaml']))).toMatchObject({ code: 'NOT_FOUND' });
    expect((await scope.run(['validate'])).data).toMatchObject({ valid: true, files: [{ path: 'agents/dev-team.yaml' }, { path: 'agents/writing.yaml' }] });
  });

  it('fails validation with schema and semantic diagnostics carrying pointers and positions', async () => {
    await scope.put('agents/bad.yaml', 'version: "3"\nagents:\n  root:\n    model: auto\n    colour: red\n    instruction: hi\n    instruction_file: x.md\n');
    await scope.put('agents/syntax.yml', 'agents: [\n');
    const error = await failure(scope.run(['validate']));
    expect(error.code).toBe('INVALID_AGENT_DEFINITION');
    const files = error.details!.files as Array<{ path: string; diagnostics: Array<Record<string, unknown>> }>;
    expect(files.map(file => file.path)).toEqual(['agents/bad.yaml', 'agents/syntax.yml']);
    expect(files[0]!.diagnostics.map(entry => [entry.code, entry.pointer, entry.line])).toEqual([
      ['unsupported-version', '/version', 1], ['schema', '/agents/root/colour', 5], ['instruction-conflict', '/agents/root/instruction_file', 7],
    ]);
    expect(files[1]!.diagnostics[0]).toMatchObject({ code: 'yaml-syntax', severity: 'error' });
    await scope.put('agents/missing-file.yaml', 'agents:\n  root:\n    model: auto\n    instruction_file: nowhere.md\n');
    expect(await failure(scope.run(['validate', 'missing-file.yaml']))).toMatchObject({ details: { files: [{ diagnostics: [expect.objectContaining({ code: 'instruction-file-missing', line: 4 })] }] } });
  });
});

describe('creating and importing agents', () => {
  it('creates a new team file, then adds agents to it with a revision guard, preserving comments', async () => {
    const flags = { file: 'team.yaml', description: 'Leads the team.', toolset: 'filesystem,shell' };
    expect((await scope.run(['create', 'lead'], flags, { dryRun: true })).data).toMatchObject({ dryRun: true, changes: [{ operation: 'created', diff: expect.stringContaining('+    model: anthropic/claude-sonnet-5') }] });
    expect((await scope.run(['create', 'lead'], flags)).data).toMatchObject({ path: 'agents/team.yaml', agent: 'lead', created: true, changes: [{ operation: 'created' }] });
    await scope.put('agents/team.yaml', `${await scope.read('agents/team.yaml')}# kept comment\n`);
    const revision = ((await scope.run(['list'])).data as { files: Array<{ revision: string }> }).files[0]!.revision;
    expect(await failure(scope.run(['create', 'helper'], { file: 'team.yaml' }))).toMatchObject({ code: 'CONFLICT', details: { currentRevision: revision } });
    expect(await failure(scope.run(['create', 'lead'], { file: 'team.yaml', 'if-match': revision }))).toMatchObject({ code: 'AGENT_EXISTS' });
    const added = await scope.run(['create', 'helper'], { file: 'team.yaml', 'if-match': revision, model: 'openai/gpt-5-mini', instruction: 'Help the lead.' }, { settings: { agents: { defaultModel: 'auto' } } });
    expect(added.data).toMatchObject({ created: false, changes: [{ operation: 'updated' }] });
    const text = await scope.read('agents/team.yaml');
    expect(text).toContain('# kept comment');
    expect(text).toMatch(/^# docker-agent configuration/);
    expect(text).toContain('  helper:\n    model: openai/gpt-5-mini\n    description: The helper agent.\n    instruction: |\n      Help the lead.\n');
    expect((await scope.run(['validate', 'team.yaml'])).data).toMatchObject({ valid: true });
    expect((await scope.run(['create', 'solo'], {}, { settings: { agents: { directory: 'team/agents', defaultModel: 'auto' } } })).data).toMatchObject({ path: 'team/agents/solo.yaml' });
    expect(await scope.read('team/agents/solo.yaml')).toContain('model: auto');
  });

  it('rejects invalid names, toolsets and results that would be invalid', async () => {
    expect(await failure(scope.run(['create', 'bad name']))).toMatchObject({ code: 'INVALID_NAME' });
    expect(await failure(scope.run(['create', 'x'], { toolset: 'mcp' }))).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(await failure(scope.run(['create', 'x'], { model: 'nowhere' }))).toMatchObject({ code: 'INVALID_AGENT_DEFINITION', details: { files: [{ diagnostics: [expect.objectContaining({ code: 'unknown-model' })] }] } });
    expect(await failure(scope.run(['create', 'x'], { 'if-match': 'a'.repeat(64) }))).toMatchObject({ code: 'CONFLICT' });
  });

  it('imports a Claude agent as an approximate docker-agent agent with diagnostics', async () => {
    await scope.put('.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews changes.\nmodel: sonnet\ntools: Read, Grep, Bash, WebSearch\npermissionMode: plan\n---\nReview the diff.\n');
    const imported = (await scope.run(['import', 'reviewer'], { from: 'claude' })).data as Record<string, unknown>;
    expect(imported).toMatchObject({ from: { target: 'claude', path: '.claude/agents/reviewer.md' }, path: 'agents/reviewer.yaml', agent: 'reviewer', created: true });
    expect((imported.diagnostics as Array<{ code: string; path: string }>).map(entry => [entry.code, entry.path])).toEqual(expect.arrayContaining([
      ['model-approximated', '.claude/agents/reviewer.md'], ['tool-unsupported', '.claude/agents/reviewer.md'], ['field-unsupported', '.claude/agents/reviewer.md'],
    ]));
    expect((await scope.run(['inspect', 'reviewer.yaml#reviewer'])).data).toMatchObject({ definition: { model: 'anthropic/claude-sonnet-5', instruction: 'Review the diff.\n', toolsets: [{ type: 'filesystem', readonly: true }, { type: 'shell' }] } });
    expect(await failure(scope.run(['import', 'reviewer'], { from: 'claude' }))).toMatchObject({ code: 'CONFLICT' });
    await scope.put('.claude/agents/broken.md', '---\nname: broken\n---\n');
    expect(await failure(scope.run(['import', '.claude/agents/broken.md'], { from: 'claude' }))).toMatchObject({ code: 'INVALID_CLAUDE_AGENT' });
    expect(await failure(scope.run(['import', 'reviewer'], { from: 'cursor' }))).toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
