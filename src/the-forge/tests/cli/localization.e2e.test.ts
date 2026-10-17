import { committedEvents } from '../support/events.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
let root: string;
beforeEach(async () => { root = await mkdtemp(join(fixture.project, 'locale-')); });
const cli = (args: string[]) => fixture.cli(args, undefined, { root });
async function configure(config: unknown) {
  await mkdir(join(root, 'bin'), { recursive: true });
  await writeFile(join(root, 'bin/config.json'), JSON.stringify(config));
}

describe('localized portable CLI', () => {
  it('uses configured language and invocation overrides without changing saved configuration', async () => {
    await configure({ settings: { language: 'de' } });
    const original = await readFile(join(root, 'bin/config.json'), 'utf8');
    expect((await cli(['help', 'read'])).body.data.description).toContain('SHA-256-Revision');
    for (const args of [['--lang', 'en', 'help', 'read'], ['help', 'read', '--lang', 'en']]) {
      const result = await cli(args);
      expect(result.status).toBe(0);
      expect(result.body.data.description).toContain('Read a document');
      expect(result.body.data.id).toBe('read');
    }
    expect((await cli(['config', '--lang', 'en'])).body.data.config.settings.language).toBe('en');
    expect(await readFile(join(root, 'bin/config.json'), 'utf8')).toBe(original);
  });

  it('keeps capability IDs, options and usage stable while translating built-in descriptions', async () => {
    const english = await cli(['schema', '--all', '--lang', 'en']), german = await cli(['--lang', 'de', 'schema', '--all']);
    expect(german.status).toBe(0);
    expect(Object.keys(german.body)).toEqual(Object.keys(english.body));
    // Option names, types, enums, defaults and document schemas stay; their descriptions, nested ones included, are German.
    type Options = Record<string, { description: string }>;
    const shape = (value: unknown): unknown => Array.isArray(value) ? value.map(shape)
      : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description').map(([key, item]) => [key, shape(item)])) : value;
    const shapes = (options: Options) => shape(options);
    const contracts = (commands: Array<{ id: string; usage: string; options: Options }>) => commands.map(({ id, usage, options }) => ({ id, usage, options: shapes(options) }));
    expect(contracts(german.body.data.commands)).toEqual(contracts(english.body.data.commands));
    expect(shapes(german.body.data.globalOptions)).toEqual(shapes(english.body.data.globalOptions));
    expect(german.body.data.globalOptions.root.description).toContain('Workspace-Stammverzeichnis');
    expect(german.body.data.commands.find((command: { id: string }) => command.id === 'edit').options.find.description).toContain('wörtlicher Text');
    expect(german.body.data.commands.find((command: { id: string }) => command.id === 'edit').options.edits.schema.items.properties.find.description).toContain('Genauer Text');
    expect(german.body.data.commands.find((command: { id: string }) => command.id === 'read').description).not.toBe(english.body.data.commands.find((command: { id: string }) => command.id === 'read').description);
    expect((await cli(['make', '--lang', 'de'])).body.data.generators.find((generator: { id: string }) => generator.id === 'ui').description).toContain('Markdown');
    // Every action description is German, including make's generators and core plugin actions; action modes stay.
    const actions = (body: { data: { commands: Array<{ id: string; annotations: { actions?: Record<string, { description: string; mutating: boolean }> } }> } }) =>
      body.data.commands.flatMap(command => Object.entries(command.annotations.actions ?? {}).map(([id, action]) => ({ key: `${command.id} ${id}`, ...action })));
    const englishActions = actions(english.body), germanActions = actions(german.body);
    expect(germanActions.length).toBeGreaterThanOrEqual(61);
    expect(germanActions.map(({ key, mutating }) => ({ key, mutating }))).toEqual(englishActions.map(({ key, mutating }) => ({ key, mutating })));
    germanActions.forEach((action, index) => expect(action.description, action.key).not.toBe(englishActions[index]!.description));
    expect((await cli(['--lang', 'de', 'help', 'links'])).body.data.annotations.actions.orphans.description).toContain('Notizen');
  });

  it('initializes the requested preference and diagnoses invalid configuration without bypassing it', async () => {
    const setup = await cli(['setup', '--lang', 'de']);
    expect(setup.status).toBe(0);
    expect(JSON.parse(await readFile(join(root, 'bin/config.json'), 'utf8')).settings.language).toBe('de');
    const original = await readFile(join(root, 'bin/config.json'), 'utf8');
    const english = await cli(['setup', '--lang', 'en']);
    expect(english.status).toBe(0);
    expect(await readFile(join(root, 'bin/config.json'), 'utf8')).toBe(original);
    // Each next step keeps its command and reads in German.
    type Step = { command: string; purpose: string };
    expect(setup.body.data.nextSteps.map((step: Step) => step.command)).toEqual(english.body.data.nextSteps.map((step: Step) => step.command));
    for (const [index, step] of (english.body.data.nextSteps as Step[]).entries()) expect(setup.body.data.nextSteps[index].purpose, step.purpose).not.toBe(step.purpose);
    await configure({ settings: { language: 'fr' } });
    const invalid = await cli(['--lang', 'de', 'config']);
    expect(invalid.status).toBe(2);
    expect(invalid.body.error.code).toBe('INVALID_CONFIG');
    expect(invalid.body.error.message).toContain('Konfiguration');
    expect(invalid.body.error.details.localization.originalMessage).toContain('settings.language');
  });

  it('preserves exit codes and structured diagnostics when localizing failures', async () => {
    await configure({ settings: { language: 'de' } });
    const german = await cli(['read', 'missing.md']), english = await cli(['read', 'missing.md', '--lang', 'en']);
    expect(german.status).toBe(3); expect(english.status).toBe(3);
    expect(german.body.error.code).toBe(english.body.error.code);
    expect(german.body.error.message).toBe('Die Datei oder Ressource missing.md wurde nicht gefunden.');
    expect(german.body.error.hint).toContain('project current'); expect(english.body.error.hint).toContain('project current');
    expect(german.body.error.details.localization.originalMessage).toBe(english.body.error.message);
    expect(committedEvents(german.body.events)).toEqual([]);
    // German messages keep the values the error names: the command, the option and the path argument.
    expect((await cli(['nosuch'])).body.error.message).toBe('Der Befehl nosuch ist nicht registriert.');
    expect((await cli(['read', 'a.md', '--nope'])).body.error.message).toBe('Der Befehl read akzeptiert die Option --nope nicht.');
    expect((await cli(['read', '../a.md'])).body.error.message).toBe('Argument <path> "../a.md" ist kein gültiger relativer Pfad im Workspace oder Projekt.');
    expect((await cli(['create', 'con.md', '--content', 'x'])).body.error.message).toContain('Argument <path> "con.md": con.md ist ein unter Windows reservierter Gerätename');
    expect((await cli(['read'])).body.error.message).toBe('Es fehlt <path>: Falsche Anzahl an Positionsargumenten, erwartet 1, erhalten 0.');
    for (const args of [['--lang', 'fr', 'help'], ['help', '--lang', 'fr'], ['--lang', 'en', 'help', '--lang', 'de']]) {
      const result = await cli(args);
      expect(result.status).toBe(2);
      expect(result.body.error.code).toBe(args.includes('fr') ? 'INVALID_LANGUAGE' : 'DUPLICATE_OPTION');
      expect(result.body.events).toEqual([]);
    }
    expect(await readdir(root)).toEqual(['bin']);
  });

  it('leaves user content and generated bytes unchanged across languages', async () => {
    await configure({ settings: { language: 'de' } });
    const literal = '--lang';
    // A literal value that starts with -- passes inline; separately, --lang would be the option.
    expect((await cli(['create', 'literal.md', `--content=${literal}`])).status).toBe(0);
    expect(await readFile(join(root, 'literal.md'), 'utf8')).toBe(literal);
    const content = '# Read a document\n\nUnknown command --lang de.\n';
    await writeFile(join(root, 'user.md'), content);
    const english = await cli(['read', 'user.md', '--lang', 'en']), german = await cli(['read', 'user.md', '--lang', 'de']);
    expect(german.body.data).toEqual(english.body.data);
    const args = ['make', 'entity', 'Example', '--dry-run'];
    expect((await cli([...args, '--lang', 'de'])).body.data).toEqual((await cli([...args, '--lang', 'en'])).body.data);
    expect((await cli(['config'])).body.data.config.settings.language).toBe('de');
  });

  it('preserves plugin descriptions, results, events and warnings', async () => {
    await configure({ settings: { language: 'de' }, plugins: { enabled: ['quality'] } });
    await mkdir(join(root, 'bin/plugins/quality'), { recursive: true });
    await writeFile(join(root, 'bin/plugins/quality/manifest.json'), JSON.stringify({ id: 'quality', name: 'Quality', version: '1.0.0', minAppVersion: '0.1.0', description: 'Read a document', author: 'Tests' }));
    await writeFile(join(root, 'bin/plugins/quality/main.mjs'), `export default {
      events: [{ id: 'quality.checked', validate: value => typeof value === 'string' }],
      commands: [{ id: 'quality.check', description: 'Read a document', usage: 'quality.check', async run(args, flags, context) {
        await context.events.emit('quality.checked', 'Unknown command'); context.events.warn('Read a document');
        return { message: 'Read a document', generators: [{ id: 'ui', description: 'User content' }] };
      } }]
    };`);
    const english = await cli(['quality.check', '--lang', 'en']), german = await cli(['quality.check', '--lang', 'de']);
    expect(german.status).toBe(0); expect(german.body).toEqual(english.body);
    expect((await cli(['help', 'quality.check'])).body.data.description).toBe('Read a document');
  });
});
