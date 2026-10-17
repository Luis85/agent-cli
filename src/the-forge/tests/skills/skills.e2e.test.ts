import { describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { unchangedRepeat } from '../support/events.ts';

const fixture = portableCli();
const cli = fixture.cli;
const ids = (items: Array<{ id: string }>) => items.map(item => item.id);
const config = (value: unknown) => writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify(value));

describe('the skills core plugin', () => {
  it('lists, shows and installs the bundled skills with an unchanged CLI contract', async () => {
    // Feature plugins contribute their skills after the shared workflow skills.
    expect((await cli(['skills'])).body.data).toEqual({ skills: ['forge-workflow', 'forge-vault', 'forge-development', 'forge-agents', 'forge-backlog', 'forge-webviews', 'forge-browser'] });
    const references = ['references/editing.md', 'references/finding.md', 'references/moving-and-locks.md'];
    expect((await cli(['skills', 'show', 'forge-vault'])).body.data).toEqual({ id: 'forge-vault', path: 'SKILL.md', content: expect.stringContaining('name: forge-vault'), files: ['SKILL.md', ...references] });
    const reference = (await cli(['skills', 'show', 'forge-vault', '--file', 'references/editing.md'])).body.data;
    expect(reference).toEqual({ id: 'forge-vault', path: 'references/editing.md', content: expect.stringContaining('# Editing vault files'), files: ['SKILL.md', ...references] });
    expect((await cli(['skills', 'show', 'forge-vault', '--file', 'references/none.md'])).body.error).toMatchObject({ code: 'INVALID_OPTION_VALUE', details: { option: 'file', value: 'references/none.md', allowed: ['SKILL.md', ...references] } });
    expect((await cli(['skills', 'list', '--file', 'SKILL.md'])).body.error.code).toBe('UNKNOWN_OPTION');
    expect((await cli(['skills', 'show', 'missing'])).body.error.code).toBe('UNKNOWN_SKILL');
    expect((await cli(['skills', 'list', '--out', 'x'])).body.error.code).toBe('UNKNOWN_OPTION');
    expect((await cli(['skills', 'list', '--target', 'claude'])).body.error.code).toBe('UNKNOWN_OPTION');
    const installed = await cli(['skills', 'install']);
    expect(installed.status).toBe(0);
    // Both agent skill roots by default: Claude Code reads .claude/skills, other agents .agents/skills. Each skill
    // folder holds SKILL.md and the reference files it links.
    const ids = ['forge-workflow', 'forge-vault', 'forge-development', 'forge-agents', 'forge-backlog', 'forge-webviews', 'forge-browser'];
    const files = await Promise.all(ids.map(async id => (await cli(['skills', 'show', id])).body.data.files as string[]));
    expect(installed.body.data.changes.map((change: { path: string }) => change.path)).toEqual(ids
      .flatMap((id, index) => ['.claude/skills', '.agents/skills'].flatMap(root => files[index]!.map(file => `${root}/${id}/${file}`))));
    for (const root of ['.claude/skills', '.agents/skills']) {
      expect(await readFile(join(fixture.project, root, 'forge-workflow/SKILL.md'), 'utf8')).toBe((await cli(['skills', 'show', 'forge-workflow'])).body.data.content);
      expect(await readFile(join(fixture.project, root, 'forge-vault/references/editing.md'), 'utf8')).toBe(reference.content);
    }
    expect(unchangedRepeat(await cli(['skills', 'install']))).toBe(true);
    await rm(join(fixture.project, '.agents'), { recursive: true, force: true });
    expect((await cli(['skills', 'install', '--target', 'agents'])).status).toBe(0);
    expect(await readFile(join(fixture.project, '.agents/skills/forge-vault/SKILL.md'), 'utf8')).toContain('name: forge-vault');
    const custom = await cli(['skills', 'install', '--out', 'tools/skills', '--dry-run']);
    expect(custom.body.data.changes.map((change: { path: string }) => change.path)).toContain('tools/skills/forge-backlog/SKILL.md');
    expect((await cli(['skills', 'install', '--out', 'x', '--target', 'claude'])).body.error.code).toBe('INVALID_ARGUMENT');
    expect((await cli(['skills', 'install', '--target', 'cursor'])).body.error.code).toBe('INVALID_OPTION_VALUE');
    for (const root of ['.agents', '.claude']) await rm(join(fixture.project, root), { recursive: true, force: true });
  });

  it('is listed as an enabled core plugin, and disabling it removes its command and skills from schema and help', async () => {
    expect((await cli(['plugins'])).body.data.plugins).toContainEqual(expect.objectContaining({ id: 'skills', core: true, state: 'enabled', contributions: expect.objectContaining({ commands: ['skills'] }) }));
    expect(ids((await cli(['schema'])).body.data.commands)).toContain('skills');
    await mkdir(join(fixture.project, 'bin'), { recursive: true });
    await config({ plugins: { disabled: ['skills'] } });
    try {
      const schema = (await cli(['schema'])).body.data;
      expect(ids(schema.commands)).not.toContain('skills');
      // Skills contributed by other plugins stay registered for setup.
      expect(schema.skills).toEqual(['forge-agents', 'forge-backlog', 'forge-webviews', 'forge-browser']);
      expect(Object.keys((await cli(['help'])).body.data.commands)).not.toContain('skills');
      expect((await cli(['help', 'skills'])).body.error.code).toBe('UNKNOWN_COMMAND');
      expect((await cli(['skills'])).body.error.code).toBe('UNKNOWN_COMMAND');
      expect((await cli(['plugins'])).body.data.plugins).toContainEqual(expect.objectContaining({ id: 'skills', core: true, state: 'disabled', contributions: null }));
      await config({ plugins: { disabled: ['quality'] } });
      const help = await cli(['help']);
      expect(help.status).toBe(0);
      expect(help.body.warnings).toEqual([expect.stringContaining('ignored quality')]);
    } finally { await rm(join(fixture.project, 'bin/config.json')); }
    expect(Object.keys((await cli(['help'])).body.data.commands)).toContain('skills');
    expect((await cli(['--no-plugins', 'skills'])).body.data.skills).toEqual(['forge-workflow', 'forge-vault', 'forge-development', 'forge-agents', 'forge-backlog', 'forge-webviews', 'forge-browser']);
  });

  it('publishes per-command JSON Schema and annotations from the same metadata as help', async () => {
    const schema = (await cli(['schema', '--all'])).body.data;
    const skills = schema.commands.find((command: { id: string }) => command.id === 'skills');
    expect(skills.inputSchema).toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['args', 'options'] });
    expect(skills.inputSchema.oneOf.map((branch: { title: string }) => branch.title)).toEqual(['skills (list)', 'skills list', 'skills show', 'skills install']);
    expect(skills.inputSchema.oneOf[3]).toMatchObject({
      properties: { args: { type: 'array', maxItems: 2, prefixItems: [{ const: 'install' }, { type: 'string' }] }, options: { properties: { target: { type: 'string', enum: ['both', 'claude', 'agents'] }, out: { type: 'string' } }, additionalProperties: false } },
    });
    expect(skills.annotations).toMatchObject({ scope: 'workspace', mutating: true, readOnlyHint: false, destructiveHint: false, actions: { list: { readOnlyHint: true }, install: { scope: 'project', mutating: true, destructiveHint: false, idempotentHint: true } } });
    expect(skills.annotations.actions.list.outputSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['skills'],
      properties: { skills: { type: 'array', items: { type: 'string' } } },
    });
    expect(skills.annotations.actions.show.outputSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['id', 'path', 'content', 'files'],
      properties: { id: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } },
    });
    const { inputSchema: _inputSchema, ...described } = skills;
    const actions = Object.fromEntries(Object.entries<Record<string, unknown>>(skills.annotations.actions).map(([id, action]) => {
      const { outputSchema: _outputSchema, ...description } = action;
      return [id, description];
    }));
    const help = (await cli(['help', 'skills'])).body.data;
    expect(help).toEqual({ ...described, annotations: { ...skills.annotations, actions }, globalOptions: schema.globalOptions });
    expect(help).not.toHaveProperty('outputSchema');
    for (const action of Object.values(help.annotations.actions)) expect(action).not.toHaveProperty('outputSchema');
    expect((await cli(['--lang', 'de', 'help', 'skills'])).body.data.description).toBe('Mitgelieferte und von Plugins bereitgestellte Agent-Skills auflisten, lesen oder installieren.');
  });
});
