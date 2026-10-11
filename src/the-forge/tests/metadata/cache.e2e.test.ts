import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { racyWindowMs } from '../../src/domain/metadata/snapshot.ts';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const cli = fixture.cli;
const cacheFile = () => join(fixture.project, '.forge/cache/metadata.v1.workspace.json');
const tags = (body: { data: { tags: Array<{ tag: string; files: string[] }> } }) => Object.fromEntries(body.data.tags.map(item => [item.tag, item.files]));

/** Rewrites one stored note's tags with a valid digest, so only a reused snapshot can report them. */
async function plantTag(path: string, tag: string) {
  const text = await readFile(cacheFile(), 'utf8');
  const header = JSON.parse(text.slice(0, text.indexOf('\n'))) as { digest: string };
  const snapshot = JSON.parse(text.slice(text.indexOf('\n') + 1)) as { files: Record<string, { revision: string }>; outcomes: Record<string, { metadata: { tags?: unknown[] } }> };
  const metadata = snapshot.outcomes[`markdown:${snapshot.files[path]!.revision}`]!.metadata;
  metadata.tags = [{ tag, position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: tag.length, offset: tag.length } } }];
  const body = JSON.stringify(snapshot);
  await writeFile(cacheFile(), `${JSON.stringify({ ...header, digest: createHash('sha256').update(body).digest('hex') })}\n${body}`);
}

describe('the persisted metadata cache through the portable CLI', () => {
  it('reuses parse results across invocations, re-reads edited notes and rebuilds a damaged cache', async () => {
    await mkdir(join(fixture.project, 'Notes'), { recursive: true });
    await writeFile(join(fixture.project, 'Notes/Plan.md'), '# Plan\n#plan and [[Ideas]]\n');
    await writeFile(join(fixture.project, 'Notes/Ideas.md'), '# Ideas\n#ideas\n');
    // Files changed within the racy window of a listing are always re-read; let these settle first.
    await new Promise(resolve => setTimeout(resolve, racyWindowMs + 200));

    // A dry run may read a cache but never writes one.
    expect(cli(['vault', 'tags', '--dry-run']).status).toBe(0);
    await expect(lstat(join(fixture.project, '.forge'))).rejects.toMatchObject({ code: 'ENOENT' });

    const first = cli(['vault', 'tags']);
    expect(first.status, first.stdout).toBe(0);
    expect(tags(first.body)).toEqual({ '#ideas': ['Notes/Ideas.md'], '#plan': ['Notes/Plan.md'] });
    expect(first.body.warnings).toEqual([]);
    expect(await readFile(join(fixture.project, '.forge/cache/.gitignore'), 'utf8')).toBe('*\n');
    // The cache is Forge's own state: no listing, vault check or event reports it.
    expect(first.body.events).toEqual([]);
    expect(cli(['list']).body.data.files.map((file: { path: string }) => file.path)).toEqual(['Notes/Ideas.md', 'Notes/Plan.md']);
    expect(cli(['vault', 'check']).body.data.findings).toEqual([]);

    // The second invocation takes Plan.md's metadata from the cache without parsing it again.
    await plantTag('Notes/Plan.md', '#from-cache');
    expect(tags(cli(['vault', 'tags']).body)).toEqual({ '#from-cache': ['Notes/Plan.md'], '#ideas': ['Notes/Ideas.md'] });

    // An external edit, as Obsidian makes it, is read again while the untouched note stays cached.
    await writeFile(join(fixture.project, 'Notes/Ideas.md'), '# Ideas\n#edited in Obsidian\n');
    expect(tags(cli(['vault', 'tags']).body)).toEqual({ '#edited': ['Notes/Ideas.md'], '#from-cache': ['Notes/Plan.md'] });

    // A truncated cache is ignored and replaced; the command still succeeds without warnings.
    const text = await readFile(cacheFile(), 'utf8');
    await writeFile(cacheFile(), text.slice(0, text.length - 10));
    const rebuilt = cli(['vault', 'tags']);
    expect(rebuilt.body.warnings).toEqual([]);
    expect(tags(rebuilt.body)).toEqual({ '#edited': ['Notes/Ideas.md'], '#plan': ['Notes/Plan.md'] });
    expect((await readFile(cacheFile(), 'utf8')).length).toBeGreaterThan(text.length - 10);

    // Deleting the cache folder is always safe.
    await rm(join(fixture.project, '.forge/cache'), { recursive: true });
    expect(tags(cli(['vault', 'tags']).body)).toEqual({ '#edited': ['Notes/Ideas.md'], '#plan': ['Notes/Plan.md'] });
  });

  it('warns in the response language when the cache cannot be saved', async () => {
    await rm(join(fixture.project, '.forge'), { recursive: true, force: true });
    // A file where the cache folder belongs makes every save fail.
    await writeFile(join(fixture.project, '.forge'), 'not a folder');
    try {
      const english = cli(['vault', 'tags']);
      expect(english.status).toBe(0);
      expect(english.body.warnings).toEqual([expect.stringMatching(/^The metadata cache could not be saved to \.forge\/cache\/metadata\.v1\.workspace\.json/)]);
      const german = cli(['vault', 'tags', '--lang', 'de']);
      expect(german.body.warnings).toEqual([expect.stringMatching(/^Der Metadaten-Cache konnte nicht unter \.forge\/cache\/metadata\.v1\.workspace\.json gespeichert werden/)]);
    } finally { await rm(join(fixture.project, '.forge'), { force: true }); }
  });
});
