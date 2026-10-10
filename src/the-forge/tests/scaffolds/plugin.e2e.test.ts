import { describe, expect, it } from 'vitest';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
const ids = (items: Array<{ id: string }>) => items.map(item => item.id);
const scaffolds = ['form', 'entity', 'value-object', 'use-case', 'event', 'plugin'];
const config = async (value: unknown) => {
  await mkdir(join(fixture.project, 'bin'), { recursive: true });
  await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify(value));
};

describe('the scaffolds core plugin', () => {
  it('contributes the code generators and the project scaffold service', () => {
    const plugin = cli(['plugins']).body.data.plugins.find((entry: { id: string }) => entry.id === 'scaffolds');
    expect(plugin).toMatchObject({ core: true, state: 'enabled', contributions: {
      commands: [], generators: scaffolds, services: { provides: ['scaffolds.projects'], requires: [] }, settings: null, strings: ['de'],
    } });
    expect(ids(cli(['make']).body.data.generators)).toEqual(expect.arrayContaining(scaffolds));
    expect(cli(['--lang', 'de', 'make']).body.data.generators).toContainEqual({ id: 'entity', description: 'Domain-Entität mit Identität und Prüfung von Invarianten.' });
  });

  it('removes its generators when disabled; project create and component fail clearly while selection keeps working', async () => {
    expect(cli(['project', 'create', 'demo']).status).toBe(0);
    await config({ plugins: { disabled: ['scaffolds'] } });
    try {
      expect(ids(cli(['schema']).body.data.generators)).toEqual(expect.not.arrayContaining(scaffolds));
      expect(cli(['make', 'entity', 'Order']).body.error.code).toBe('UNKNOWN_GENERATOR');
      const create = cli(['project', 'create', 'other']);
      expect(create.status).toBe(2);
      expect(create.body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { command: 'project create', plugin: 'scaffolds', service: 'scaffolds.projects', issues: [] } });
      expect(create.body.error.details.reason).toContain('disabled');
      expect(cli(['project', 'component', 'demo', 'Widget']).body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { command: 'project component', plugin: 'scaffolds' } });
      expect(cli(['project', 'list']).body.data.projects.map((project: { name: string }) => project.name)).toEqual(['demo']);
      expect(cli(['project', 'open', 'demo']).status).toBe(0);
      expect(cli(['project', 'close']).status).toBe(0);
      expect(await readdir(join(fixture.project, 'projects'))).toEqual(['demo']);
    } finally { await rm(join(fixture.project, 'bin/config.json')); }
    expect(cli(['project', 'component', 'demo', 'Widget']).status).toBe(0);
  });
});
