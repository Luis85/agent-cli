import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { warningMessages } from '../support/warnings.ts';

const fixture = portableCli();
const cli = fixture.cli;
type Reason = { code: string; message: string; details?: Record<string, unknown> };
const warning = 'plugins.enabled names nope, but bin/plugins/nope/manifest.json does not exist';

describe('a user plugin that plugins.enabled names but bin/plugins lacks', () => {
  it('is a missing plugin with a warning, and every other command keeps working', async () => {
    await mkdir(join(fixture.project, 'bin/plugins/hello'), { recursive: true });
    await writeFile(join(fixture.project, 'bin/plugins/hello/manifest.json'), JSON.stringify({ id: 'hello', name: 'Hello', version: '1.0.0', minAppVersion: '0.1.0', description: 'Greets', author: 'Test' }));
    await writeFile(join(fixture.project, 'bin/plugins/hello/main.mjs'), "export default { commands: [{ id: 'hello.run', description: 'Greet', usage: 'hello.run', mutating: false, run: () => ({ hello: true }) }] };\n");
    await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['nope', 'hello'] } }));
    for (const args of [['help'], ['setup'], ['config'], ['hello.run']]) {
      const result = await cli(args);
      expect(result.status, `${args.join(' ')}: ${result.stdout}`).toBe(0);
      expect(result.body.warnings, args.join(' ')).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PLUGIN_MISSING_WARNING', message: expect.stringContaining(warning) })]));
    }
    const listed = (await cli(['plugins'])).body.data.plugins as Array<{ id: string; state: string; reason: Reason | null; contributions: unknown }>;
    expect(listed.find(plugin => plugin.id === 'nope')).toEqual({ id: 'nope', core: false, state: 'missing', reason: { code: 'PLUGIN_MISSING', message: expect.stringContaining('remove it from plugins.enabled'), details: { plugin: 'nope', path: 'bin/plugins/nope/manifest.json' } }, contributions: null });
    expect(listed.find(plugin => plugin.id === 'hello')).toMatchObject({ state: 'enabled' });
    expect((await cli(['nope.run'])).body.error.code).toBe('UNKNOWN_COMMAND');
    // The warning and the reason are kernel messages: German responses render them in German.
    const german = await cli(['--lang', 'de', 'plugins']);
    expect(warningMessages(german.body)).toEqual(expect.arrayContaining([expect.stringContaining('plugins.enabled nennt nope, aber bin/plugins/nope/manifest.json existiert nicht')]));
    expect(german.body.data.plugins.find((plugin: { id: string }) => plugin.id === 'nope').reason).toEqual({ code: 'PLUGIN_MISSING', message: expect.stringContaining('entfernen Sie es aus plugins.enabled'), details: { plugin: 'nope', path: 'bin/plugins/nope/manifest.json' } });
  });

  it('makes a plugin that requires its services unavailable, and every other command keeps working', async () => {
    await mkdir(join(fixture.project, 'bin/plugins/needy'), { recursive: true });
    await writeFile(join(fixture.project, 'bin/plugins/needy/manifest.json'), JSON.stringify({ id: 'needy', name: 'Needy', version: '1.0.0', minAppVersion: '0.1.0', description: 'Needs nope', author: 'Test' }));
    await writeFile(join(fixture.project, 'bin/plugins/needy/main.mjs'), "export default { requires: ['nope.greeter'], commands: [{ id: 'needy.run', description: 'Greet', usage: 'needy.run', mutating: false, run: () => ({ needy: true }) }] };\n");
    await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['nope', 'needy', 'hello'] } }));
    for (const args of [['list'], ['hello.run'], ['config']]) expect((await cli(args)).status, args.join(' ')).toBe(0);
    // The reason has a stable code in both languages, in plugins and in the failure of the plugin's command.
    const details = { service: 'nope.greeter', provider: 'nope' };
    const reason = { code: 'PLUGIN_PROVIDER_MISSING', message: 'Requires service nope.greeter; its provider nope is missing.', details };
    expect((await cli(['needy.run'])).body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { plugin: 'needy', reason } });
    const listed = (await cli(['plugins'])).body.data.plugins as Array<{ id: string; state: string; reason: Reason | null }>;
    expect(listed.find(plugin => plugin.id === 'needy')).toMatchObject({ state: 'unavailable', reason });
    const germanReason = { code: 'PLUGIN_PROVIDER_MISSING', message: 'Benötigt den Dienst nope.greeter; sein Anbieter nope fehlt.', details };
    const german = (await cli(['--lang', 'de', 'plugins'])).body.data.plugins as Array<{ id: string; reason: Reason | null }>;
    expect(german.find(plugin => plugin.id === 'needy')).toMatchObject({ reason: germanReason });
    expect((await cli(['--lang', 'de', 'needy.run'])).body.error).toMatchObject({ code: 'PLUGIN_UNAVAILABLE', details: { plugin: 'needy', reason: germanReason } });
  });

  it('is still listed as missing when --no-plugins skips the user plugins', async () => {
    const result = await cli(['--no-plugins', 'plugins']);
    const users = (result.body.data.plugins as Array<{ id: string; core: boolean; state: string }>).filter(plugin => !plugin.core);
    expect(users.map(plugin => [plugin.id, plugin.state]).sort()).toEqual([['hello', 'skipped'], ['needy', 'skipped'], ['nope', 'missing']]);
    expect(result.body.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PLUGIN_MISSING_WARNING', message: expect.stringContaining(warning) })]));
  });
});
