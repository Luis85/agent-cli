import { describe, expect, it } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
const ids = (items: Array<{ id: string }>) => items.map(item => item.id);
const config = (value: unknown) => writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify(value));

describe('the skills core plugin', () => {
  it('lists, shows and installs the bundled skills with an unchanged CLI contract', async () => {
    expect(cli(['skills']).body.data).toEqual({ skills: ['forge-workflow', 'forge-vault', 'forge-development'] });
    expect(cli(['skills', 'show', 'forge-vault']).body.data).toEqual({ id: 'forge-vault', content: expect.stringContaining('name: forge-vault') });
    expect(cli(['skills', 'show', 'missing']).body.error.code).toBe('UNKNOWN_SKILL');
    expect(cli(['skills', 'list', '--out', 'x']).body.error.code).toBe('INVALID_ARGUMENT');
    expect(cli(['skills', 'install']).status).toBe(0);
    expect(await readFile(join(fixture.project, '.agents/skills/forge-workflow/SKILL.md'), 'utf8')).toContain('CONFLICT');
    expect(cli(['skills', 'install']).body.error.code).toBe('CONFLICT');
    await rm(join(fixture.project, '.agents'), { recursive: true, force: true });
  });

  it('is listed as an enabled core plugin, and disabling it removes its command and skills from schema and help', async () => {
    expect(cli(['plugins']).body.data.plugins).toContainEqual(expect.objectContaining({ id: 'skills', core: true, state: 'enabled', contributions: expect.objectContaining({ commands: ['skills'] }) }));
    expect(ids(cli(['schema']).body.data.commands)).toContain('skills');
    await mkdir(join(fixture.project, 'bin'), { recursive: true });
    await config({ plugins: { disabled: ['skills'] } });
    try {
      const schema = cli(['schema']).body.data;
      expect(ids(schema.commands)).not.toContain('skills');
      expect(schema.skills).toEqual([]);
      expect(ids(cli(['help']).body.data.commands)).not.toContain('skills');
      expect(cli(['help', 'skills']).body.error.code).toBe('UNKNOWN_COMMAND');
      expect(cli(['skills']).body.error.code).toBe('UNKNOWN_COMMAND');
      expect(cli(['plugins']).body.data.plugins).toContainEqual(expect.objectContaining({ id: 'skills', core: true, state: 'disabled', contributions: null }));
      await config({ plugins: { disabled: ['quality'] } });
      expect(cli(['help']).body.error).toMatchObject({ code: 'INVALID_PLUGIN_CONFIG', message: expect.stringContaining('remove quality') });
    } finally { await rm(join(fixture.project, 'bin/config.json')); }
    expect(ids(cli(['help']).body.data.commands)).toContain('skills');
    expect(cli(['--no-plugins', 'skills']).body.data.skills).toEqual(['forge-workflow', 'forge-vault', 'forge-development']);
  });

  it('publishes per-command JSON Schema and annotations from the same metadata as help', () => {
    const schema = cli(['schema']).body.data;
    const skills = schema.commands.find((command: { id: string }) => command.id === 'skills');
    expect(skills.inputSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
      properties: { args: { type: 'array', maxItems: 2 }, options: { properties: { out: { type: 'string', default: '.agents/skills' } }, additionalProperties: false } },
    });
    expect(skills.annotations).toMatchObject({ scope: 'workspace', readOnlyHint: true, actions: { install: { scope: 'project', mutating: true } } });
    const { inputSchema: _inputSchema, ...described } = skills;
    expect(cli(['help', 'skills']).body.data).toEqual({ ...described, globalOptions: schema.globalOptions });
    expect(cli(['--lang', 'de', 'help', 'skills']).body.data.description).toBe('Mitgelieferte und von Plugins bereitgestellte Agent-Skills auflisten, lesen oder installieren.');
  });
});
