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

describe('the links core plugin through the portable CLI', () => {
  it('reports backlinks, unresolved links, orphans and dead ends read-only, and follows a link-updating move', async () => {
    for (const [path, content] of [
      ['Home.md', '# Home\n[[Projects/Alpha]] and [[Ideas]]\n'],
      ['Projects/Alpha.md', '---\nowner: "[[People/Ada]]"\n---\nBack to [[Home]].\n'],
      ['Notes/Ideas.md', 'Nothing yet.\n'],
      ['Archive/Ideas.md', 'Old ideas.\n'],
    ]) expect(cli(['create', path!, '--content', content!]).status).toBe(0);

    const back = cli(['--events', 'all', 'links', 'back', 'Projects/Alpha.md']);
    expect(back.status, back.stdout).toBe(0);
    expect(back.body.data).toEqual({ path: 'Projects/Alpha.md', backlinks: [
      { source: 'Home.md', kind: 'link', line: 2, column: 1, offset: 7, original: '[[Projects/Alpha]]', link: 'Projects/Alpha', displayText: 'Projects/Alpha', status: 'resolved', target: 'Projects/Alpha.md', via: 'path' },
    ], issues: [] });
    expect(back.body.events.some((event: { id: string }) => event.id.startsWith('vault.'))).toBe(false);

    expect(cli(['links', 'unresolved']).body.data.links).toEqual([
      expect.objectContaining({ source: 'Home.md', original: '[[Ideas]]', status: 'unresolved', reason: 'ambiguous', candidates: ['Archive/Ideas.md', 'Notes/Ideas.md'] }),
      expect.objectContaining({ source: 'Projects/Alpha.md', kind: 'frontmatter', key: 'owner', status: 'unresolved', reason: 'missing' }),
    ]);
    expect(cli(['links', 'unresolved', '--path', 'Projects/**']).body.data.links).toHaveLength(1);
    expect(cli(['links', 'orphans']).body.data.files).toEqual(['Archive/Ideas.md', 'Notes/Ideas.md']);
    expect(cli(['links', 'deadends']).body.data.files).toEqual(['Archive/Ideas.md', 'Notes/Ideas.md']);
    expect(cli(['links', 'out', 'Nope.md']).body.error.code).toBe('NOT_FOUND');

    const revision = cli(['read', 'Projects/Alpha.md']).body.data.revision;
    expect(cli(['move', 'Projects/Alpha.md', 'Projects/Beta.md', '--if-match', revision]).status).toBe(0);
    expect(cli(['links', 'back', 'Projects/Beta.md']).body.data.backlinks).toEqual([expect.objectContaining({ source: 'Home.md', original: '[[Projects/Beta]]' })]);
  });

  it('excludes configured roots from orphans, describes itself in German and can be disabled', async () => {
    expect(cli(['config']).body.data.config.plugins.settings.links).toEqual({ roots: [] });
    await configure({ plugins: { settings: { links: { roots: ['Archive/**'] } } } });
    try {
      expect(cli(['links', 'orphans']).body.data.files).toEqual(['Notes/Ideas.md']);
      // An invalid section makes only its plugin unavailable; discovery, recovery and other commands keep working.
      await configure({ plugins: { disabled: ['serach'], settings: { links: { roots: ['[z-a]'] }, lnks: { roots: [] } } } });
      const failed = cli(['links', 'orphans']);
      expect(failed.body.error).toMatchObject({ code: 'INVALID_CONFIG', details: { plugin: 'links', issues: ['plugins.settings.links.roots[0]: has the reversed class range [z-a].'] } });
      expect(failed.body.warnings).toEqual([
        expect.stringContaining('ignored serach'),
        expect.stringContaining('Plugin links is unavailable in this invocation'),
        expect.stringContaining('plugins.settings names no installed plugin: lnks'),
      ]);
      for (const args of [['help'], ['schema'], ['config'], ['plugins'], ['list'], ['--no-plugins', 'search', 'Ideas']]) expect(cli(args).status, args.join(' ')).toBe(0);
      expect(cli(['config']).body.data.config.plugins.settings.links).toEqual({ roots: ['[z-a]'] });
      expect(cli(['plugins']).body.data.plugins.find((plugin: { id: string }) => plugin.id === 'links')).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('roots[0]'), contributions: { commands: ['links'] } });
      await configure({ plugins: { disabled: ['links'] } });
      expect(cli(['help', 'links']).body.error.code).toBe('UNKNOWN_COMMAND');
    } finally { await rm(join(fixture.project, 'bin/config.json')); }
    expect(cli(['--lang', 'de', 'help', 'links']).body.data).toMatchObject({
      description: expect.stringContaining('Rückverweise'), annotations: { scope: 'project', readOnlyHint: true, actions: { orphans: { mutating: false } } },
    });
  });
});
