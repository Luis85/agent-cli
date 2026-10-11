import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
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
      expect(result.body.warnings, args.join(' ')).toEqual(expect.arrayContaining([expect.stringContaining(warning)]));
    }
    const listed = (await cli(['plugins'])).body.data.plugins as Array<{ id: string; state: string; reason: string | null; contributions: unknown }>;
    expect(listed.find(plugin => plugin.id === 'nope')).toEqual({ id: 'nope', core: false, state: 'missing', reason: expect.stringContaining('remove it from plugins.enabled'), contributions: null });
    expect(listed.find(plugin => plugin.id === 'hello')).toMatchObject({ state: 'enabled' });
    expect((await cli(['nope.run'])).body.error.code).toBe('UNKNOWN_COMMAND');
    // The warning and the reason are kernel messages: German responses render them in German.
    const german = await cli(['--lang', 'de', 'plugins']);
    expect(german.body.warnings).toEqual(expect.arrayContaining([expect.stringContaining('plugins.enabled nennt nope, aber bin/plugins/nope/manifest.json existiert nicht')]));
    expect(german.body.data.plugins.find((plugin: { id: string }) => plugin.id === 'nope').reason).toContain('entfernen Sie es aus plugins.enabled');
  });
});
