import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const ids = (items: Array<{ id: string }>) => items.map(item => item.id);
const configure = (value: unknown) => writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify(value));

describe('the bases core plugin', () => {
  it('is an enabled core plugin; disabling it removes bases from schema, help and dispatch, and re-enabling restores it', async () => {
    const plugin = fixture.cli(['plugins']).body.data.plugins.find((entry: { id: string }) => entry.id === 'bases');
    expect(plugin).toMatchObject({ id: 'bases', core: true, state: 'enabled', contributions: { commands: ['bases'], strings: ['de'] } });
    expect(fixture.cli(['--lang', 'de', 'help', 'bases']).body.data.description).toBe('Native Obsidian-Bases-Ansichten ohne laufendes Obsidian als Datei-Repositories abfragen.');
    expect(fixture.cli(['bases', 'list']).body.data).toEqual({ files: [], scope: fixture.project });

    await mkdir(join(fixture.project, 'bin'), { recursive: true });
    await configure({ plugins: { disabled: ['bases'] } });
    try {
      expect(ids(fixture.cli(['schema']).body.data.commands)).not.toContain('bases');
      expect(ids(fixture.cli(['help']).body.data.commands)).not.toContain('bases');
      expect(fixture.cli(['help', 'bases']).body.error.code).toBe('UNKNOWN_COMMAND');
      const dispatched = fixture.cli(['bases', 'list']);
      expect(dispatched.status).toBe(2);
      expect(dispatched.body.error.code).toBe('UNKNOWN_COMMAND');
      expect(fixture.cli(['plugins']).body.data.plugins).toContainEqual(expect.objectContaining({ id: 'bases', core: true, state: 'disabled', contributions: null }));
      // A .base file stays an ordinary document without the plugin.
      expect(fixture.cli(['create', 'tasks.base']).status).toBe(0);
      expect(fixture.cli(['validate', 'tasks.base']).body.data).toMatchObject({ valid: true, kind: 'base' });
    } finally { await rm(join(fixture.project, 'bin/config.json')); }

    expect(ids(fixture.cli(['schema']).body.data.commands)).toContain('bases');
    expect(fixture.cli(['bases', 'list']).body.data.files).toEqual(['tasks.base']);
  });
});
