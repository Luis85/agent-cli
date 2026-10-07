import { beforeAll, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
let project: string, bundle: string;
beforeAll(() => { project = fixture.project; bundle = fixture.bundle; });

it('loads fixed workspace configuration and allows invocation overrides', async () => {
    const configuredRoot = join(project, 'configured-workspace');
    await mkdir(join(configuredRoot, 'bin'), { recursive: true });
    const config = join(configuredRoot, 'bin/config.json');
    await writeFile(config, JSON.stringify({ paths: { projects: 'src' }, settings: { dryRun: true, json: true } }));
    const invocation = { root: configuredRoot, cwd: bundle };
    const loaded = cli(['config'], undefined, invocation);
    expect(loaded.status).toBe(0);
    expect(loaded.body.data.root).toBe(configuredRoot);
    expect(loaded.body.data.config.paths.projects).toBe('src');
    expect(loaded.body.data.path).toBe(config);
    const make = ['make', 'entity', 'ConfiguredItem', '--out', 'generated/models'];
    const preview = cli(make, undefined, invocation);
    expect(preview.status).toBe(0); expect(preview.body.data.dryRun).toBe(true); expect(preview.body.events).toEqual([]);
    expect(await readdir(configuredRoot)).toEqual(['bin']);
    expect(cli(['--no-dry-run', ...make], undefined, invocation).status).toBe(0);
    expect(await readFile(join(configuredRoot, 'generated/models/configured-item.ts'), 'utf8')).toContain('class ConfiguredItem');
    expect(cli(['config']).body.data.root).toBe(project);
    for (const invalid of [{ settings: { dryrun: true } }, { paths: { templates: '../outside' } }, { paths: { root: '..' } }, { plugins: { enabled: ['same', 'same'] } }, { unknown: true }]) {
      await writeFile(config, JSON.stringify(invalid));
      expect(cli(['config'], undefined, invocation).body.error.code).toBe('INVALID_CONFIG');
    }
    await rm(config);
    expect(cli(['config'], undefined, invocation).body.data.path).toBeNull();
    expect(cli(['--config', config, 'config']).body.error.code).toBe('UNKNOWN_OPTION');
  });
