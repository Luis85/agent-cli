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

describe('the search core plugin through the portable CLI', () => {
  it('finds hits with revisions that guard a follow-up edit, pages them and publishes no events', async () => {
    expect(cli(['create', 'notes/plan.md', '--content', '---\nstatus: draft\ntags: [roadmap]\n---\n# Plan\nShip the -beta plan.\n']).status).toBe(0);
    expect(cli(['create', 'notes/other.md', '--content', 'Another plan.\n']).status).toBe(0);
    const found = cli(['--events', 'all', 'search', 'plan', '--tag', 'roadmap', '--in', 'body', '--context', '1']);
    expect(found.status, found.stdout).toBe(0);
    expect(found.body.data).toEqual({ hits: [
      { path: 'notes/plan.md', line: 5, column: 3, match: 'Plan', snippet: '# Plan', before: ['---'], after: ['Ship the -beta plan.'], revision: expect.any(String) },
      { path: 'notes/plan.md', line: 6, column: 16, match: 'plan', snippet: 'Ship the -beta plan.', before: ['# Plan'], after: [''], revision: expect.any(String) },
    ], total: 2 });
    expect(found.body.events.some((event: { id: string }) => event.id.startsWith('vault.') || event.id === 'workspace.file-open')).toBe(false);
    const { revision } = found.body.data.hits[0];
    expect(cli(['edit', 'notes/plan.md', '--find', '# Plan', '--replace', '# Roadmap', '--if-match', revision]).status).toBe(0);

    const page = cli(['search', 'plan', '--limit', '1']).body.data;
    expect(page).toMatchObject({ hits: [{ path: 'notes/other.md' }], total: 2, nextCursor: expect.any(String) });
    expect(cli(['search', 'plan', '--limit', '1', '--cursor', page.nextCursor]).body.data).toMatchObject({ hits: [{ path: 'notes/plan.md', line: 6 }], total: 2 });
    expect(cli(['search', '--', '-beta']).body.data.hits).toEqual([expect.objectContaining({ match: '-beta' })]);
    expect(cli(['search', 'plan', '--property', 'status=draft', '--regex', '--case-sensitive']).body.data.total).toBe(1);
  });

  it('reports invalid patterns and inputs with localized plugin error codes', () => {
    const invalid = cli(['search', '(', '--regex']);
    expect(invalid.status).toBe(2);
    expect(invalid.body.error).toMatchObject({ code: 'INVALID_SEARCH_PATTERN', retryable: false, hint: expect.stringContaining('without --regex') });
    expect(cli(['--lang', 'de', 'search', '(', '--regex']).body.error).toMatchObject({ code: 'INVALID_SEARCH_PATTERN', message: 'Das Suchmuster ist ungültig.' });
    for (const args of [['--kind', 'image'], ['--in', 'code'], ['--context', '51'], ['--limit', '0'], ['--property', '=x'], ['--cursor', 'bogus']]) {
      expect(cli(['search', 'plan', ...args]).body.error.code, args.join(' ')).toBe('INVALID_ARGUMENT');
    }
    const schema = cli(['schema']).body.data;
    expect(schema.errors).toContainEqual(expect.objectContaining({ code: 'SEARCH_TIMEOUT', plugin: 'search', exitCode: 2 }));
    expect(schema.commands.find((command: { id: string }) => command.id === 'search')).toMatchObject({
      annotations: { scope: 'project', mutating: false, readOnlyHint: true }, outputSchema: { required: ['hits', 'total'] },
    });
    expect(cli(['--lang', 'de', 'help', 'search']).body.data.description).toContain('Textdateien');
  });

  it('bounds regular-expression matching by the configured timeout and can be disabled', async () => {
    await writeFile(join(fixture.project, 'slow.txt'), `${'a'.repeat(40)}!\n`);
    expect(cli(['config']).body.data.config.plugins.settings.search).toEqual({ timeoutMs: 10_000 });
    await configure({ plugins: { settings: { search: { timeoutMs: 200 } } } });
    try {
      const slow = cli(['search', '^(a+)+$', '--regex', '--path', 'slow.txt']);
      expect(slow.status).toBe(2);
      expect(slow.body.error).toMatchObject({ code: 'SEARCH_TIMEOUT', details: { timeoutMs: 200 } });
      await configure({ plugins: { disabled: ['search'] } });
      expect(cli(['search', 'plan']).body.error.code).toBe('UNKNOWN_COMMAND');
      expect(cli(['schema']).body.data.commands.map((command: { id: string }) => command.id)).not.toContain('search');
    } finally { await rm(join(fixture.project, 'bin/config.json')); }
  });
});
