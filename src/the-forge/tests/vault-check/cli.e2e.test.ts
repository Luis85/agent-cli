import { describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
const configure = async (value: unknown) => {
  await mkdir(join(fixture.project, 'bin'), { recursive: true });
  await writeFile(join(fixture.project, 'bin/config.json'), JSON.stringify(value));
};

describe('the vault-check core plugin through the portable CLI', () => {
  it('checks a clean vault, fails --strict on a broken link with exit status 2 and passes once it is fixed', async () => {
    for (const [path, content] of [
      ['Home.md', '# Home\n[[Projects/Alpha#Goals]] and ![[assets/logo.png]]\n'],
      ['Projects/Alpha.md', '---\nstatus: active\nowner: "[[People/Ada]]"\n---\n# Alpha\n## Goals\nBack to [[Home]].\n'],
      ['People/Ada.md', '---\nstatus: active\n---\nAda.\n'],
      ['Tasks.base', 'views:\n  - type: table\n    name: Active\n    filters: status == "active"\n'],
    ]) expect((await cli(['create', path!, '--content', content!])).status).toBe(0);
    await mkdir(join(fixture.project, 'assets'), { recursive: true });
    await writeFile(join(fixture.project, 'assets/logo.png'), 'png');

    const clean = await cli(['vault', 'check', '--strict']);
    expect(clean.status, clean.stdout).toBe(0);
    expect(clean.body.data).toMatchObject({ findings: [], summary: { files: 5, findings: 0, error: 0, warning: 0, info: 0 }, skipped: [], strict: true });
    expect(clean.body.events).toEqual([]);

    expect((await cli(['create', 'Draft.md', '--content', 'See [[Projects/Alpah]].\n'])).status).toBe(0);
    const failed = await cli(['vault', 'check', '--strict']);
    expect(failed.status).toBe(2);
    expect(failed.body.error).toMatchObject({
      code: 'VAULT_CHECK_FAILED', retryable: false, hint: expect.stringContaining('error.details.findings'),
      details: { summary: { error: 1 }, findings: [{ rule: 'unresolved-link', severity: 'error', path: 'Draft.md', line: 1, column: 5, suggestion: 'Projects/Alpha.md' }], truncated: false },
    });
    const german = await cli(['--lang', 'de', 'vault', 'check', '--strict']);
    expect(german.body.error).toMatchObject({ code: 'VAULT_CHECK_FAILED', message: 'vault check --strict hat Befunde mit Schweregrad error gefunden.', details: { findings: [{ message: 'Der Link [[Projects/Alpah]] verweist auf keine Datei.' }] } });
    // Without --strict findings never fail the command.
    expect((await cli(['vault'])).status).toBe(0);

    const revision = (await cli(['read', 'Draft.md'])).body.data.revision;
    expect((await cli(['edit', 'Draft.md', '--find', 'Alpah', '--replace', 'Alpha', '--if-match', revision])).status).toBe(0);
    expect((await cli(['vault', 'check', '--strict'])).status).toBe(0);
  });

  it('honours .obsidian/types.json and inventories tags and properties', async () => {
    await mkdir(join(fixture.project, '.obsidian'), { recursive: true });
    await writeFile(join(fixture.project, '.obsidian/types.json'), '{"types":{"status":"checkbox"}}');
    try {
      const check = await cli(['vault', 'check', '--rule', 'property-type-mismatch']);
      expect(check.body.data.findings.map((finding: { path: string; line: number; message: string }) => [finding.path, finding.line, finding.message])).toEqual([
        ['People/Ada.md', 2, 'Property status is text here, but .obsidian/types.json declares it checkbox.'],
        ['Projects/Alpha.md', 2, 'Property status is text here, but .obsidian/types.json declares it checkbox.'],
      ]);
      expect((await cli(['vault', 'properties', '--name', 'status'])).body.data).toEqual({
        properties: [{ name: 'status', count: 2, empty: 0, types: { text: 2 }, type: 'text', declared: 'checkbox', conflicting: true, files: [{ path: 'People/Ada.md', type: 'text' }, { path: 'Projects/Alpha.md', type: 'text' }] }],
        typesFile: { path: '.obsidian/types.json', status: 'loaded' },
      });
    } finally { await rm(join(fixture.project, '.obsidian'), { recursive: true, force: true }); }
    expect((await cli(['create', 'Tagged.md', '--content', '---\ntags: [area/work]\n---\n#area/home\n'])).status).toBe(0);
    expect((await cli(['vault', 'tags', '--sort', 'count'])).body.data.tags).toEqual([
      { tag: '#area', count: 1, files: ['Tagged.md'] },
      { tag: '#area/home', count: 1, files: ['Tagged.md'] },
      { tag: '#area/work', count: 1, files: ['Tagged.md'] },
    ]);
  });

  it('is described in German, owns its error code, and can be disabled with or without bases', async () => {
    expect((await cli(['--lang', 'de', 'help', 'vault'])).body.data).toMatchObject({
      description: expect.stringContaining('defekte Links'), errors: expect.arrayContaining(['VAULT_CHECK_FAILED']),
      annotations: { scope: 'project', readOnlyHint: true, defaultAction: 'check', actions: { check: { mutating: false, options: { strict: expect.any(Object) } } } },
    });
    expect((await cli(['schema'])).body.data.errors).toContainEqual(expect.objectContaining({ code: 'VAULT_CHECK_FAILED', plugin: 'vault-check', exitCode: 2, category: 'input' }));
    expect((await cli(['plugins'])).body.data.plugins.find((plugin: { id: string }) => plugin.id === 'vault-check')).toMatchObject({
      core: true, state: 'enabled', contributions: { commands: ['vault'], events: [], services: { provides: [], requires: [], optional: ['bases.validation'] }, settings: 'plugins.settings.vault-check' },
    });
    expect((await cli(['config'])).body.data.config.plugins.settings['vault-check']).toEqual({ rules: {}, ignore: [] });
    expect((await cli(['create', 'Broken.base', '--content', 'views:\n  - type: table\n    name: Open\n'])).status).toBe(0);
    expect((await cli(['patch', 'Broken.base', '--pointer', '/views/0/filters', '--value', '"status =="', '--if-match', (await cli(['read', 'Broken.base'])).body.data.revision])).status).toBe(0);
    try {
      expect((await cli(['vault', 'check', '--rule', 'invalid-base'])).body.data.findings).toEqual([expect.objectContaining({ rule: 'invalid-base', path: 'Broken.base', message: expect.stringContaining('View Open of the Base is invalid') })]);
      await configure({ plugins: { disabled: ['bases'] } });
      const withoutBases = await cli(['vault', 'check', '--rule', 'invalid-base', '--strict']);
      expect(withoutBases.status).toBe(0);
      expect(withoutBases.body.data).toMatchObject({ findings: [], rules: [], skipped: [{ rule: 'invalid-base', reason: 'unavailable' }] });
      await configure({ plugins: { disabled: ['vault-check'], settings: { 'vault-check': { ignore: ['**'] } } } });
      expect((await cli(['vault', 'check'])).body.error.code).toBe('UNKNOWN_COMMAND');
      expect((await cli(['plugins'])).body.data.plugins.find((plugin: { id: string }) => plugin.id === 'vault-check')).toMatchObject({ state: 'disabled', contributions: null });
      expect((await cli(['links', 'unresolved'])).status).toBe(0);
    } finally { await rm(join(fixture.project, 'bin/config.json'), { force: true }); }
  });
});
