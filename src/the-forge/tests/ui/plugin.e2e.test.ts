import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const ids = (items: Array<{ id: string }>) => items.map(item => item.id);
const configure = async (value: unknown) => {
  await mkdir(join(fixture.project, 'bin'), { recursive: true });
  await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify(value));
};
const reset = () => rm(join(fixture.project, 'bin/config.json'), { force: true });

describe('the ui core plugin', () => {
  it('owns components, interactions, make ui and make stories with German strings and a settings section', () => {
    const plugin = fixture.cli(['plugins']).body.data.plugins.find((entry: { id: string }) => entry.id === 'ui');
    expect(plugin).toMatchObject({ id: 'ui', core: true, state: 'enabled', contributions: { commands: ['components', 'interactions'], generators: ['ui', 'stories'], strings: ['de'] } });
    expect(fixture.cli(['--lang', 'de', 'help', 'interactions']).body.data.description).toBe('Wiederverwendbare Markdown-Interaktionen für ausführbares UI-Verhalten verwalten.');
    expect(fixture.cli(['--lang', 'de', 'make']).body.data.generators).toContainEqual({ id: 'stories', description: 'Native Storybook-CSF-Stories für vorhandene UI-Komponenten generieren.' });
    expect(fixture.cli(['--lang', 'de', 'components']).body.data).toMatchObject({ status: 'empty', nextStep: 'Führen Sie components init --library components aus oder fügen Sie eine Markdown-Definition hinzu.' });
    expect(fixture.cli(['--lang', 'de', 'interactions', 'validate']).body.data.nextStep).toBe('Führen Sie interactions init --library interactions aus oder fügen Sie eine Markdown-Definition hinzu.');
    expect(fixture.cli(['components']).body.data.nextStep).toBe('Run components init --library components, or add a Markdown component definition.');
    const config = fixture.cli(['config']).body.data;
    expect(config.config.plugins.settings.ui).toEqual({
      framework: 'html', components: 'components', componentImports: 'imports/components', componentExports: 'exports/components',
      interactions: 'interactions', interactionImports: 'imports/interactions', interactionExports: 'exports/interactions', output: 'src/ui', stories: 'stories',
    });
    expect(config.sections).toContainEqual(expect.objectContaining({ plugin: 'ui', path: 'plugins.settings.ui' }));
  });

  it('makes the plugin unavailable for an invalid section and names the problem', async () => {
    await configure({ plugins: { settings: { ui: { componentExports: '../escape', framework: 'qt' } } } });
    try {
      const listed = fixture.cli(['components']);
      expect(listed.status).toBe(2);
      expect(listed.body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { command: 'components', plugin: 'ui' } });
      expect(listed.body.error.details.issues).toEqual([expect.stringContaining('plugins.settings.ui.framework')]);
      expect(fixture.cli(['make', 'ui', 'page']).body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { generator: 'ui', plugin: 'ui' } });
      await configure({ plugins: { settings: { ui: { componentExports: '../escape' } } } });
      expect(fixture.cli(['interactions']).body.error.details.issues).toEqual(['plugins.settings.ui.componentExports: Must be a contained workspace-relative path.']);
      // Former kernel keys are rejected; the settings moved without aliases.
      await configure({ paths: { components: 'library' } });
      expect(fixture.cli(['components']).body.error.code).toBe('INVALID_CONFIG');
    } finally { await reset(); }
  });

  it('removes its commands and generators when disabled and restores them when re-enabled', async () => {
    await configure({ plugins: { disabled: ['ui'] } });
    try {
      const schema = fixture.cli(['schema']).body.data;
      for (const id of ['components', 'interactions']) {
        expect(ids(schema.commands)).not.toContain(id);
        expect(fixture.cli(['help', id]).body.error.code).toBe('UNKNOWN_COMMAND');
        expect(fixture.cli([id, 'list']).body.error.code).toBe('UNKNOWN_COMMAND');
      }
      expect(ids(schema.generators)).not.toContain('ui');
      expect(ids(schema.generators)).not.toContain('stories');
      expect(Object.keys(fixture.cli(['help', 'make']).body.data.annotations.actions)).not.toContain('ui');
      for (const generator of ['ui', 'stories']) {
        expect(fixture.cli(['make', generator, 'page']).body.error.code).toBe('UNKNOWN_GENERATOR');
        expect(fixture.cli(['make', generator, 'page', '--framework', 'react', '--plan']).body.error.code).toBe('UNKNOWN_GENERATOR');
      }
      expect(fixture.cli(['plugins']).body.data.plugins).toContainEqual(expect.objectContaining({ id: 'ui', core: true, state: 'disabled', reason: 'Listed in plugins.disabled.', contributions: null }));
      expect(fixture.cli(['config']).body.data.config.plugins.settings).not.toHaveProperty('ui');
    } finally { await reset(); }
    expect(ids(fixture.cli(['schema']).body.data.commands)).toEqual(expect.arrayContaining(['components', 'interactions']));
    expect(fixture.cli(['make', 'ui', 'page']).body.error.code).toBe('EMPTY_UI_LIBRARY');
  });
});
