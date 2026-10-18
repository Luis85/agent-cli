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
  it('contributes the code generators and the project scaffold service', async () => {
    const plugin = (await cli(['plugins'])).body.data.plugins.find((entry: { id: string }) => entry.id === 'scaffolds');
    expect(plugin).toMatchObject({ core: true, state: 'enabled', contributions: {
      commands: [], generators: scaffolds, services: { provides: ['scaffolds.projects'], requires: [] }, settings: null, strings: ['de'],
    } });
    expect(ids((await cli(['make'])).body.data.generators)).toEqual(expect.arrayContaining(scaffolds));
    expect((await cli(['--lang', 'de', 'make'])).body.data.generators).toContainEqual({ id: 'entity', description: 'Domain-Entität mit Identität und Prüfung von Invarianten.' });
  });

  it('writes use cases to the application layer and the other code scaffolds to the domain layer by default', async () => {
    const paths = async (generator: string, name: string) => (await cli(['make', generator, name, '--dry-run'])).body.data.changes.map((change: { path: string }) => change.path);
    expect(await paths('use-case', 'FindItem')).toEqual(['src/application/find-item.ts']);
    expect(await paths('entity', 'Order')).toEqual(['src/domain/order.ts']);
  });

  it('removes its generators when disabled; project create and component fail clearly while selection keeps working', async () => {
    expect((await cli(['project', 'create', 'demo'])).status).toBe(0);
    await config({ plugins: { disabled: ['scaffolds'] } });
    try {
      expect(ids((await cli(['schema'])).body.data.generators)).toEqual(expect.not.arrayContaining(scaffolds));
      expect((await cli(['make', 'entity', 'Order'])).body.error.code).toBe('UNKNOWN_GENERATOR');
      const create = await cli(['project', 'create', 'other']);
      expect(create.status).toBe(2);
      expect(create.body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { command: 'project create', plugin: 'scaffolds', service: 'scaffolds.projects', issues: [] } });
      expect(create.body.error.details.reason).toEqual({ code: 'PLUGIN_PROVIDER_DISABLED', message: 'Requires service scaffolds.projects; its provider scaffolds is disabled.', details: { service: 'scaffolds.projects', provider: 'scaffolds' } });
      // The summary covers kernel commands that need a service of the unavailable plugin.
      expect((await cli(['schema', '--all'])).body.data.errors).toContainEqual(expect.objectContaining({ code: 'PLUGIN_UNAVAILABLE', summary: 'The command or generator belongs to, or needs a service of, a plugin that is disabled, missing or unavailable.' }));
      const german = (await cli(['--lang', 'de', 'project', 'create', 'other'])).body.error;
      expect(german.details.reason).toEqual({ code: 'PLUGIN_PROVIDER_DISABLED', message: 'Benötigt den Dienst scaffolds.projects; sein Anbieter scaffolds ist deaktiviert.', details: { service: 'scaffolds.projects', provider: 'scaffolds' } });
      expect(german.message).toBe('Der Befehl oder Generator gehört zu einem Plugin, das deaktiviert, nicht installiert oder nicht verfügbar ist, oder benötigt einen Dienst eines solchen Plugins.');
      expect((await cli(['project', 'component', 'demo', 'Widget'])).body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { command: 'project component', plugin: 'scaffolds' } });
      expect((await cli(['project', 'list'])).body.data.projects.map((project: { name: string }) => project.name)).toEqual(['demo']);
      expect((await cli(['project', 'open', 'demo'])).status).toBe(0);
      expect((await cli(['project', 'close'])).status).toBe(0);
      expect(await readdir(join(fixture.project, 'projects'))).toEqual(['demo']);
    } finally { await rm(join(fixture.project, 'bin/config.json')); }
    expect((await cli(['project', 'component', 'demo', 'Widget'])).status).toBe(0);
  });
});
