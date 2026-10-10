import { beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
let root: string;
const run = (...args: string[]) => fixture.cli(args, undefined, { root });
const configure = (settings: Record<string, unknown>) => writeFile(join(root, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['quality'], settings: { quality: settings } } }));

beforeAll(async () => {
  root = join(fixture.project, 'example');
  await mkdir(join(root, 'bin/plugins'), { recursive: true });
  await cp(join(fixture.bundle, 'bin/data/docs/examples/plugins/quality'), join(root, 'bin/plugins/quality'), { recursive: true });
  await writeFile(join(root, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['quality'] } }));
});

describe('the packaged quality example plugin', () => {
  it('reacts to vault renames and edits frontmatter through the app facade', async () => {
    expect(run('create', 'notes/Spec.md', '--content', '---\ndraft: true\n---\n# Spec\n').status).toBe(0);
    expect(run('quality.check').body.data).toEqual({ notes: 1 });

    const preview = run('quality.mark-reviewed', 'notes/Spec.md', '--dry-run');
    expect(preview.body.data.changes[0].diff).toContain('-draft: true\n+reviewed: true');
    const reviewed = run('quality.mark-reviewed', 'notes/Spec.md');
    expect(reviewed.status, reviewed.stdout).toBe(0);
    expect(await readFile(join(root, 'notes/Spec.md'), 'utf8')).toBe('---\nreviewed: true\n---\n# Spec\n');

    const revision = run('read', 'notes/Spec.md').body.data.revision;
    const moved = run('rename', 'notes/Spec.md', 'Requirements', '--if-match', revision);
    expect(moved.status, moved.stdout).toBe(0);
    expect(moved.body.warnings).toEqual(['Quality noticed notes/Spec.md moved to notes/Requirements.md; review notes that describe it.']);
    const back = run('--lang', 'de', 'rename', 'notes/Requirements.md', 'Spec', '--if-match', revision);
    expect(back.body.warnings).toEqual(['Quality hat bemerkt, dass notes/Requirements.md nach notes/Spec.md verschoben wurde; prüfen Sie Notizen, die es beschreiben.']);
  });

  it('contributes a validated config section shown by config, with defaults and change notifications', async () => {
    const config = run('config');
    expect(config.body.data.config.plugins.settings).toEqual({ quality: { ownerProperty: 'owner' } });
    expect(config.body.data.sections).toEqual([{ plugin: 'quality', path: 'plugins.settings.quality', schema: expect.objectContaining({ type: 'object' }) }]);
    await configure({ ownerProperty: '' });
    expect(run('config').body.error).toMatchObject({ code: 'INVALID_CONFIG', message: 'plugins.settings.quality.ownerProperty: must have at least 1 characters' });
    await configure({ ownerProperty: 'maintainer' });
    const changed = run('quality.check');
    expect(changed.body.warnings).toEqual(['Quality settings changed; owner property is now maintainer.']);
    expect(run('quality.check').body.warnings).toEqual([]);
  });

  it('reads note metadata through app.metadataCache and fails with its own localized error code', async () => {
    const unowned = run('quality.owners');
    expect(unowned.status).toBe(5);
    expect(unowned.body.error).toEqual({
      code: 'QUALITY_UNOWNED', message: '1 notes have no maintainer.', retryable: false,
      hint: 'Add the owner property named in error.details.property to each note in error.details.notes.', details: { property: 'maintainer', notes: ['notes/Spec.md'] },
    });
    expect(run('--lang', 'de', 'quality.owners').body.error).toMatchObject({ code: 'QUALITY_UNOWNED', message: 'Einige Notizen haben keine Verantwortlichen.' });
    const revision = run('read', 'notes/Spec.md').body.data.revision;
    expect(run('properties', 'notes/Spec.md', '--set', '{"maintainer":"Ada"}', '--if-match', revision).status).toBe(0);
    expect(run('quality.owners').body.data).toEqual({ property: 'maintainer', unowned: [] });
  });

  it('describes its commands in German and lists its contributions and error codes', () => {
    expect(run('--lang', 'de', 'help', 'quality.owners').body.data).toMatchObject({ description: 'Notizen ohne Verantwortliche finden', errors: ['QUALITY_UNOWNED'], annotations: { mutating: false } });
    const schema = run('schema').body.data;
    expect(schema.errors).toContainEqual({ code: 'QUALITY_UNOWNED', exitCode: 5, category: 'drift', retryable: false, summary: 'Some notes have no owner.', plugin: 'quality' });
    const plugins = run('plugins').body.data.plugins;
    expect(plugins.map((plugin: { id: string; core: boolean; state: string }) => [plugin.id, plugin.core, plugin.state])).toEqual([['skills', true, 'enabled'], ['quality', false, 'enabled']]);
    expect(plugins[1].contributions).toMatchObject({ commands: ['quality.check', 'quality.mark-reviewed', 'quality.owners'], settings: 'plugins.settings.quality', strings: ['de', 'en'], errors: ['QUALITY_UNOWNED'] });
  });
});
