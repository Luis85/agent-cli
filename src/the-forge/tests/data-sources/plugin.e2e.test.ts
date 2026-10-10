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

describe('the data-sources core plugin', () => {
  it('owns data-sources and make data-source with German strings and a settings section', () => {
    const plugin = fixture.cli(['plugins']).body.data.plugins.find((entry: { id: string }) => entry.id === 'data-sources');
    expect(plugin).toMatchObject({ id: 'data-sources', core: true, state: 'enabled', contributions: { commands: ['data-sources'], generators: ['data-source'], strings: ['de'] } });
    const help = fixture.cli(['--lang', 'de', 'help', 'data-sources']).body.data;
    expect(help.description).toBe('Markdown-Datenquellen verwalten, prüfen, importieren und exportieren.');
    expect(help.annotations.actions.list.description).toBe('Die Datenquellendefinitionen der Bibliothek auflisten.');
    expect(fixture.cli(['--lang', 'de', 'data-sources']).body.data.nextStep).toBe('Führen Sie data-sources init --library data-sources aus oder fügen Sie eine Markdown-Definition hinzu.');
    expect(fixture.cli(['config']).body.data.config.plugins.settings['data-sources']).toEqual({
      library: 'data-sources', imports: 'imports/data-sources', exports: 'exports/data-sources', output: 'src/data-sources', fixtures: 'test-data',
    });
  });

  it('makes the plugin unavailable for an invalid section and rejects the former kernel keys', async () => {
    await configure({ plugins: { settings: { 'data-sources': { fixtures: '../escape' } } } });
    try {
      const failed = fixture.cli(['make', 'data-source', 'requests']);
      expect(failed.body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { generator: 'data-source', plugin: 'data-sources', issues: ['plugins.settings.data-sources.fixtures: Must be a contained workspace-relative path.'] } });
      expect(fixture.cli(['data-sources']).body.error.code).toBe('PLUGIN_UNAVAILABLE');
      // The ui plugin does not depend on data-sources and keeps working.
      expect(fixture.cli(['components']).status).toBe(0);
      await configure({ paths: { dataFixtures: 'fixtures' } });
      expect(fixture.cli(['data-sources']).body.error.code).toBe('INVALID_CONFIG');
    } finally { await reset(); }
  });

  it('removes its command and generator when disabled and restores them when re-enabled', async () => {
    await configure({ plugins: { disabled: ['data-sources'] } });
    try {
      const schema = fixture.cli(['schema']).body.data;
      expect(ids(schema.commands)).not.toContain('data-sources');
      expect(ids(schema.generators)).not.toContain('data-source');
      expect(fixture.cli(['data-sources', 'list']).body.error.code).toBe('UNKNOWN_COMMAND');
      expect(fixture.cli(['make', 'data-source', 'requests']).body.error.code).toBe('UNKNOWN_GENERATOR');
      expect(Object.keys(fixture.cli(['help', 'make']).body.data.annotations.actions)).not.toContain('data-source');
      expect(fixture.cli(['plugins']).body.data.plugins).toContainEqual(expect.objectContaining({ id: 'data-sources', state: 'disabled', contributions: null }));
      // Disabling one feature plugin leaves the other in place.
      expect(ids(schema.commands)).toEqual(expect.arrayContaining(['components', 'interactions']));
    } finally { await reset(); }
    expect(fixture.cli(['make', 'data-source', 'requests']).body.error.code).toBe('EMPTY_DATA_SOURCE_LIBRARY');
  });
});
