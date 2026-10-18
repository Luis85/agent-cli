import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const ids = (items: Array<{ id: string }>) => items.map(item => item.id);
const configure = (value: unknown) => writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify(value));

describe('the bases core plugin', () => {
  it('is an enabled core plugin; disabling it removes bases from schema, help and dispatch, and re-enabling restores it', async () => {
    const plugin = (await fixture.cli(['plugins'])).body.data.plugins.find((entry: { id: string }) => entry.id === 'bases');
    expect(plugin).toMatchObject({ id: 'bases', core: true, state: 'enabled', contributions: { commands: ['bases'], strings: ['de'] } });
    expect((await fixture.cli(['--lang', 'de', 'help', 'bases'])).body.data.description).toBe('Native Obsidian-Bases-Ansichten ohne laufendes Obsidian als Datei-Repositories abfragen.');
    expect((await fixture.cli(['bases', 'list'])).body.data).toEqual({ files: [], scope: fixture.project });

    await mkdir(join(fixture.project, 'bin'), { recursive: true });
    await configure({ plugins: { disabled: ['bases'] } });
    try {
      expect(ids((await fixture.cli(['schema'])).body.data.commands)).not.toContain('bases');
      expect(Object.keys((await fixture.cli(['help'])).body.data.commands)).not.toContain('bases');
      expect((await fixture.cli(['help', 'bases'])).body.error.code).toBe('UNKNOWN_COMMAND');
      const dispatched = await fixture.cli(['bases', 'list']);
      expect(dispatched.status).toBe(2);
      expect(dispatched.body.error.code).toBe('UNKNOWN_COMMAND');
      const plugins = (await fixture.cli(['plugins'])).body.data.plugins;
      expect(plugins).toContainEqual(expect.objectContaining({ id: 'bases', core: true, state: 'disabled', reason: { code: 'PLUGIN_LISTED_DISABLED', message: 'Listed in plugins.disabled.' }, contributions: null }));
      const reason = { code: 'PLUGIN_PROVIDER_DISABLED', message: 'Requires service bases.query; its provider bases is disabled.', details: { service: 'bases.query', provider: 'bases' } };
      // backlog requires bases.query: it stays registered and listed, but is unavailable and its command reports why.
      expect(plugins).toContainEqual(expect.objectContaining({ id: 'backlog', core: true, state: 'unavailable', reason, contributions: expect.objectContaining({ commands: ['backlog'] }) }));
      expect((await fixture.cli(['help', 'backlog'])).body.data.id).toBe('backlog');
      const cascaded = await fixture.cli(['backlog', 'list']);
      expect(cascaded.status).toBe(2);
      expect(cascaded.body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { command: 'backlog', plugin: 'backlog', reason, issues: [] } });
      expect(cascaded.body.warnings).toEqual([]);
      // A .base file stays an ordinary document without the plugin.
      expect((await fixture.cli(['create', 'tasks.base'])).status).toBe(0);
      expect((await fixture.cli(['validate', 'tasks.base'])).body.data).toMatchObject({ valid: true, kind: 'base' });
    } finally { await rm(join(fixture.project, 'bin/config.json')); }

    expect(ids((await fixture.cli(['schema'])).body.data.commands)).toContain('bases');
    expect((await fixture.cli(['bases', 'list'])).body.data.files).toEqual(['tasks.base']);
  });
});
