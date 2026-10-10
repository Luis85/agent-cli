import { describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
const ok = (args: string[]) => {
  const result = cli(args);
  expect(result.status, result.stdout).toBe(0);
  return result.body.data;
};

describe('the agents core plugin through the portable CLI', () => {
  it('creates, validates, generates and drift-checks a docker-agent team', async () => {
    ok(['agents', 'create', 'lead', '--file', 'team.yaml', '--description', 'Leads the team.', '--instruction', 'Plan the work for ${env.PROJECT}.', '--toolset', 'filesystem,shell']);
    const revision = ok(['agents', 'list']).files[0].revision;
    ok(['agents', 'create', 'scout', '--file', 'team.yaml', '--description', 'Researches.', '--model', 'openai/gpt-5-mini', '--toolset', 'fetch,think', '--if-match', revision]);
    const team = await readFile(join(fixture.project, 'agents/team.yaml'), 'utf8');
    await writeFile(join(fixture.project, 'agents/team.yaml'), team.replace('    toolsets:\n      - type: filesystem', '    sub_agents: [scout] # delegates research\n    toolsets:\n      - type: filesystem'));
    expect(ok(['agents', 'validate'])).toMatchObject({ valid: true, files: [{ path: 'agents/team.yaml', diagnostics: [] }] });
    expect(ok(['agents', 'list']).files[0]).toMatchObject({ default: 'lead', agents: [{ name: 'lead', subAgents: ['scout'] }, { name: 'scout', model: 'openai/gpt-5-mini' }] });

    const generated = cli(['--events', 'all', 'agents', 'generate', '--target', 'claude', '--model-style', 'alias']);
    expect(generated.status, generated.stdout).toBe(0);
    expect(generated.body.data.files).toEqual([{ path: '.claude/agents/lead.md', status: 'missing' }, { path: '.claude/agents/scout.md', status: 'missing' }]);
    expect(generated.body.data.diagnostics.map((entry: { code: string; pointer: string }) => `${entry.code} ${entry.pointer}`)).toEqual(expect.arrayContaining([
      'template-literal /agents/lead/instruction', 'model-alias /agents/lead/model', 'model-approximated /agents/scout/model', 'toolset-approximated /agents/scout/toolsets/1',
    ]));
    expect(generated.body.events.filter((event: { id: string }) => event.id === 'agents.generated')).toHaveLength(1);
    const lead = await readFile(join(fixture.project, '.claude/agents/lead.md'), 'utf8');
    expect(lead).toContain('tools: Read, Write, Edit, Glob, Grep, Bash, Agent(scout)\nmodel: sonnet\n');
    expect(ok(['claude', 'agents', 'inspect', 'lead'])).toMatchObject({ metadata: { name: 'lead', 'x-forge-source': { path: 'agents/team.yaml', agent: 'lead' } } });
    expect(ok(['agents', 'generate', '--target', 'claude', '--model-style', 'alias', '--check'])).toMatchObject({ check: true, matches: true });

    await writeFile(join(fixture.project, '.claude/agents/scout.md'), (await readFile(join(fixture.project, '.claude/agents/scout.md'), 'utf8')).replace('Researches.\n', 'Edited by hand.\n'));
    const drift = cli(['agents', 'generate', '--target', 'claude', '--model-style', 'alias', '--check']);
    expect(drift.status).toBe(5);
    expect(drift.body.error).toMatchObject({ code: 'AGENT_DRIFT', hint: expect.stringContaining('--plan-out'), details: { outputs: [{ path: '.claude/agents/scout.md', status: 'hand-edited' }] } });
    ok(['agents', 'generate', '--target', 'claude', '--model-style', 'alias', '--plan-out', 'review.json']);
    expect(ok(['agents', 'generate', '--target', 'claude', '--model-style', 'alias', '--revisions-from', 'review.json']).changes).toEqual([expect.objectContaining({ path: '.claude/agents/scout.md', operation: 'updated' })]);
    expect(ok(['agents', 'generate', '--target', 'claude', '--model-style', 'alias', '--check']).matches).toBe(true);
  });

  it('imports a hand-written Claude agent with diagnostics and round-trips it through generation', async () => {
    await mkdir(join(fixture.project, '.claude/agents'), { recursive: true });
    await writeFile(join(fixture.project, '.claude/agents/critic.md'), '---\nname: critic\ndescription: Critiques designs.\nmodel: opus\ntools: Read, Grep, WebSearch\ncolor: red\n---\nCritique the design.\n');
    const imported = ok(['agents', 'import', 'critic', '--from', 'claude', '--file', 'design.yaml']);
    expect(imported).toMatchObject({ path: 'agents/design.yaml', agent: 'critic', created: true });
    expect(imported.diagnostics.map((entry: { code: string; fidelity: string }) => `${entry.code}:${entry.fidelity}`)).toEqual(expect.arrayContaining(['model-approximated:A', 'toolset-approximated:A', 'tool-unsupported:U', 'field-unsupported:U']));
    const generated = ok(['agents', 'generate', '--target', 'claude', '--file', 'design.yaml', '--plan']);
    expect(generated.files).toEqual([{ path: '.claude/agents/critic.md', status: 'hand-edited' }]);
    expect(generated.outputs[0].content).toContain('name: critic\ndescription: Critiques designs.\ntools: Read, Glob, Grep\nmodel: claude-opus-5\n');
    const conflict = cli(['agents', 'import', 'critic', '--from', 'claude', '--file', 'design.yaml', '--if-match', ok(['agents', 'inspect', 'design.yaml']).revision]);
    expect([conflict.status, conflict.body.error.code]).toEqual([2, 'AGENT_EXISTS']);
  });

  it('describes itself in German, reports plugin errors and can be disabled', async () => {
    expect(cli(['--lang', 'de', 'help', 'agents']).body.data).toMatchObject({
      description: expect.stringContaining('docker-agent-Definitionen'), annotations: { scope: 'project', actions: { generate: { mutating: true }, list: { mutating: false } } },
    });
    const missing = cli(['--lang', 'de', 'agents', 'inspect', 'design.yaml#nobody']);
    expect(missing.status).toBe(3);
    expect(missing.body.error).toMatchObject({ code: 'AGENT_NOT_FOUND', message: expect.stringContaining('Agenten'), hint: expect.stringContaining('agents list') });
    expect(ok(['config']).config.plugins.settings.agents).toEqual({ directory: 'agents', defaultModel: 'anthropic/claude-sonnet-5' });
    expect(ok(['skills', 'list']).skills).toContain('forge-agents');
    await mkdir(join(fixture.project, 'bin'), { recursive: true });
    await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify({ plugins: { disabled: ['agents'] } }));
    try { expect(cli(['agents', 'list']).body.error.code).toBe('UNKNOWN_COMMAND'); }
    finally { await rm(join(fixture.project, 'bin/config.json')); }
  });
});
