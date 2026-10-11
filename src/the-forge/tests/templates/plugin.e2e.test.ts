import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
const ids = (items: Array<{ id: string }>) => items.map(item => item.id);
const config = async (value: unknown) => {
  await mkdir(join(fixture.project, 'bin'), { recursive: true });
  await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify(value));
};
const paths = (changes: Array<{ path: string }>) => changes.map(change => change.path);

describe('the templates core plugin', () => {
  it('contributes the templates command, make document, its settings section and the setup template service', () => {
    const plugin = cli(['plugins']).body.data.plugins.find((entry: { id: string }) => entry.id === 'templates');
    expect(plugin).toMatchObject({ core: true, state: 'enabled', contributions: {
      commands: ['templates'], generators: ['document'], services: { provides: ['templates.installer'], requires: [] }, settings: 'plugins.settings.templates', strings: ['de'],
    } });
    expect(cli(['config']).body.data.config).toMatchObject({ plugins: { settings: { templates: { dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm' } } } });
    expect(cli(['config']).body.data.config).not.toHaveProperty('templates');
    expect(cli(['--lang', 'de', 'make']).body.data.generators).toContainEqual({ id: 'document', description: 'Obsidian-Markdown-/Frontmatter-Vorlagen mit typisierten Werten rendern.' });
  });

  it('removes its command and generator when disabled, and setup then skips the templates with a warning', async () => {
    await config({ plugins: { disabled: ['templates'] } });
    try {
      const schema = cli(['schema']).body.data;
      expect(ids(schema.commands)).not.toContain('templates');
      expect(ids(schema.generators)).not.toContain('document');
      expect(cli(['templates']).body.error.code).toBe('UNKNOWN_COMMAND');
      // Without the generator, its id is unknown, and that outranks its options.
      expect(cli(['make', 'document', 'Plan']).body.error.code).toBe('UNKNOWN_GENERATOR');
      expect(cli(['make', 'document', 'Plan', '--template', 'entity.md']).body.error).toMatchObject({ code: 'UNKNOWN_GENERATOR', message: 'document' });
      const setup = cli(['setup', '--dry-run']);
      expect(setup.status).toBe(0);
      expect(paths(setup.body.data.changes).filter(path => path.startsWith('bin/templates/'))).toEqual([]);
      expect(setup.body.data.nextSteps.map((step: { command: string }) => step.command)).toEqual(['node bin/forge.js project list']);
      expect(setup.body.warnings).toEqual([expect.stringContaining('templates core plugin is disabled or unavailable')]);
      expect(cli(['plugins']).body.data.plugins).toContainEqual(expect.objectContaining({ id: 'templates', state: 'disabled', contributions: null }));
    } finally { await rm(join(fixture.project, 'bin/config.json')); }
    const setup = cli(['setup', '--dry-run']).body;
    expect(paths(setup.data.changes)).toEqual(expect.arrayContaining(['bin/templates/entity.md', 'bin/templates/workflow/prd.md']));
    expect(setup.warnings).toEqual([]);
  });

  it('makes only itself unavailable when its settings section is invalid', async () => {
    await config({ plugins: { settings: { templates: { dateFormat: '' } } } });
    try {
      const make = cli(['make', 'document', 'Plan', '--template', 'entity.md']);
      expect(make.body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { generator: 'document', plugin: 'templates', issues: ['plugins.settings.templates.dateFormat: must have at least 1 characters'] } });
      expect(cli(['templates']).body.error.code).toBe('PLUGIN_UNAVAILABLE');
      expect(cli(['setup', '--dry-run']).body.warnings).toEqual(expect.arrayContaining([expect.stringContaining('templates core plugin is disabled or unavailable')]));
    } finally { await rm(join(fixture.project, 'bin/config.json')); }
  });
});
