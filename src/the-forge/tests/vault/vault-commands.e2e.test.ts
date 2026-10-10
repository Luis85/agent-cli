import { describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';
import { writeVault } from '../support/vault.ts';

const fixture = portableCli();
type Record = { id: string; payload: { path?: string; oldPath?: string; [key: string]: unknown } };

/** A plugin that reports the metadata cache's unresolved links and uses the app facade, as a plugin author would. */
const checker = `
  export default {
    onload({ app, events }) {
      app.vault.on('rename', ({ path, oldPath }) => events.warn('renamed ' + oldPath + ' -> ' + path));
    },
    commands: [
      { id: 'checker.unresolved', description: 'Count unresolved links', usage: 'checker.unresolved', async run(args, flags, { app }) {
        const unresolved = await app.metadataCache.unresolvedLinks();
        return { unresolved: Object.values(unresolved).reduce((total, links) => total + Object.values(links).reduce((sum, count) => sum + count, 0), 0), files: await app.vault.getMarkdownFiles() };
      } },
      { id: 'checker.review', description: 'Mark a note reviewed', usage: 'checker.review <path>', async run([path], flags, { app }) {
        return app.fileManager.processFrontMatter(path, frontmatter => { frontmatter.reviewed = true; delete frontmatter.draft; });
      } },
      { id: 'checker.rename', description: 'Rename through the facade', usage: 'checker.rename <from> <to>', run([from, to], flags, { app }) {
        return app.fileManager.renameFile(from, to);
      } },
    ],
  };
`;

async function workspace(name: string) {
  const root = join(fixture.project, name);
  await mkdir(join(root, 'bin/plugins/checker'), { recursive: true });
  await writeFile(join(root, 'bin/config.json'), JSON.stringify({ plugins: { enabled: ['checker'] } }));
  await writeFile(join(root, 'bin/plugins/checker/manifest.json'), JSON.stringify({ id: 'checker', name: 'Checker', version: '1.0.0', minAppVersion: '0.1.0', description: 'Link checks', author: 'Tests' }));
  await writeFile(join(root, 'bin/plugins/checker/main.mjs'), checker);
  await writeVault(root, {
    'docs/Index.md': '---\nrelated: "[[Plan]]"\nsteps:\n  - "[[Plan#Goals|goals]]"\n---\n# Index\n\nSee [[Plan]], ![[Plan#^b1]] and [the plan](../notes/Plan.md#Goals).\n',
    'notes/Plan.md': '---\ndraft: true\n---\n# Plan\n\n## Goals\n\nShip it. ^b1\n\nBack to [index](../docs/Index.md).\n',
    'Board.canvas': '{"nodes":[{"id":"plan","type":"file","file":"notes/Plan.md","subpath":"#Goals","x":0,"y":0,"width":400,"height":300}],"edges":[]}\n',
    'scratch/Idea.md': '# Idea\n',
  });
  return { root, run: (...args: string[]) => fixture.cli(args, undefined, { root }), read: (path: string) => readFile(join(root, path), 'utf8') };
}

describe('moving and deleting through the portable CLI', () => {
  it('renames a note referenced from frontmatter, body text and a Canvas in one batch without broken links', async () => {
    const { run, read } = await workspace('rename');
    expect(run('checker.unresolved').body.data.unresolved).toBe(0);
    const preview = run('rename', 'notes/Plan.md', 'Roadmap', '--dry-run');
    expect(preview.status, preview.stdout).toBe(0);
    expect(preview.body.data).toMatchObject({ dryRun: true, to: 'notes/Roadmap.md', links: { updated: 6, files: 2, unrewritten: [] } });
    expect(preview.body.data.changes.map((change: { path: string }) => change.path)).toEqual(['Board.canvas', 'docs/Index.md']);
    expect(preview.body.events).toEqual([]);
    const missing = run('rename', 'notes/Plan.md', 'Roadmap');
    expect(missing.status).toBe(2);
    expect(missing.body.error.code).toBe('MISSING_ARGUMENT');

    const renamed = run('--events', 'all', 'rename', 'notes/Plan.md', 'Roadmap', '--if-match', preview.body.data.revision);
    expect(renamed.status, renamed.stdout).toBe(0);
    const records = renamed.body.events.filter((event: Record) => /^(vault|metadataCache)\./.test(event.id)).map((event: Record) => [event.id, event.payload.path]);
    expect(records).toEqual([
      ['vault.rename', 'notes/Roadmap.md'], ['vault.modify', 'Board.canvas'], ['vault.modify', 'docs/Index.md'],
      ['metadataCache.changed', 'Board.canvas'], ['metadataCache.changed', 'docs/Index.md'],
      ['metadataCache.resolve', 'Board.canvas'], ['metadataCache.resolve', 'docs/Index.md'], ['metadataCache.resolve', 'notes/Roadmap.md'],
      ['metadataCache.resolved', undefined],
    ]);
    expect(renamed.body.warnings).toEqual(['renamed notes/Plan.md -> notes/Roadmap.md']);
    expect(await read('docs/Index.md')).toBe('---\nrelated: "[[Roadmap]]"\nsteps:\n  - "[[Roadmap#Goals|goals]]"\n---\n# Index\n\nSee [[Roadmap]], ![[Roadmap#^b1]] and [the plan](../notes/Roadmap.md#Goals).\n');
    expect(JSON.parse(await read('Board.canvas')).nodes[0]).toMatchObject({ file: 'notes/Roadmap.md', subpath: '#Goals' });
    expect(run('checker.unresolved').body.data).toEqual({ unresolved: 0, files: ['docs/Index.md', 'notes/Roadmap.md', 'scratch/Idea.md'] });
    expect(run('read', 'docs/Index.md').body.data.document.properties).toEqual({ related: '[[Roadmap]]', steps: ['[[Roadmap#Goals|goals]]'] });
  });

  it('moves folders, refuses existing destinations and supports facade renames and frontmatter edits', async () => {
    const { run, read } = await workspace('folders');
    const preview = run('move', 'notes', 'archive/notes', '--dry-run');
    expect(preview.body.data).toMatchObject({ kind: 'folder', renames: [{ from: 'notes', to: 'archive/notes', kind: 'folder' }, { from: 'notes/Plan.md', to: 'archive/notes/Plan.md', kind: 'file' }] });
    const moved = run('move', 'notes', 'archive/notes', '--if-match', preview.body.data.revision);
    expect(moved.status, moved.stdout).toBe(0);
    expect(moved.body.events.map((event: Record) => [event.id, event.payload.path])).toEqual([
      ['vault.create', 'archive'], ['vault.rename', 'archive/notes'], ['vault.rename', 'archive/notes/Plan.md'], ['vault.modify', 'Board.canvas'], ['vault.modify', 'archive/notes/Plan.md'], ['vault.modify', 'docs/Index.md'],
    ]);
    expect(await read('archive/notes/Plan.md')).toContain('Back to [index](../../docs/Index.md).');
    expect(await read('docs/Index.md')).toContain('[the plan](../archive/notes/Plan.md#Goals)');
    const clash = run('move', 'scratch/Idea.md', 'docs/Index.md', '--if-match', run('read', 'scratch/Idea.md').body.data.revision);
    expect(clash.status).toBe(2);
    expect(clash.body.error).toMatchObject({ code: 'DESTINATION_EXISTS', details: { path: 'docs/Index.md', from: 'scratch/Idea.md' } });
    expect(run('checker.rename', 'scratch/Idea.md', 'ideas/Idea.md').body.data).toMatchObject({ to: 'ideas/Idea.md' });
    const reviewed = run('checker.review', 'archive/notes/Plan.md');
    expect(reviewed.status, reviewed.stdout).toBe(0);
    expect(await read('archive/notes/Plan.md')).toMatch(/^---\nreviewed: true\n---\n# Plan\n/);
    expect(run('checker.unresolved').body.data.unresolved).toBe(0);
  });

  it('refuses to delete linked notes, trashes scratch notes and removes permanently on request', async () => {
    const { root, run } = await workspace('delete');
    const plan = run('read', 'notes/Plan.md').body.data.revision;
    const refused = run('delete', 'notes/Plan.md', '--if-match', plan);
    expect(refused.status).toBe(2);
    expect(refused.body.error).toMatchObject({ code: 'HAS_BACKLINKS', retryable: false });
    expect(refused.body.error.details.backlinks.map((link: { source: string; line: number | null }) => [link.source, link.line])).toEqual([
      ['Board.canvas', null], ['docs/Index.md', 8], ['docs/Index.md', 8], ['docs/Index.md', 8], ['docs/Index.md', null], ['docs/Index.md', null],
    ]);
    const german = run('--lang', 'de', 'delete', 'notes/Plan.md', '--if-match', plan);
    expect(german.body.error.message).toBe('Andere Notizen verlinken noch auf die Datei oder den Ordner.');
    const idea = run('read', 'scratch/Idea.md').body.data.revision;
    const trashed = run('--events', 'all', 'delete', 'scratch/Idea.md', '--if-match', idea);
    expect(trashed.status, trashed.stdout).toBe(0);
    expect(trashed.body.data).toMatchObject({ permanent: false, trashPath: '.trash/scratch/Idea.md', deleted: [{ path: 'scratch/Idea.md', revision: idea }], brokenLinks: [] });
    expect(trashed.body.events.filter((event: Record) => /^(vault|metadataCache)\./.test(event.id)).map((event: Record) => event.id)).toEqual(['vault.delete', 'metadataCache.deleted', 'metadataCache.resolved']);
    expect(await readFile(join(root, '.trash/scratch/Idea.md'), 'utf8')).toBe('# Idea\n');
    const folder = run('delete', 'scratch', '--recursive', '--permanent', '--dry-run').body.data;
    expect(folder).toMatchObject({ kind: 'folder', deleted: [] });
    expect(run('delete', 'scratch', '--recursive', '--permanent', '--if-match', folder.revision).status).toBe(0);
    expect((await readdir(root)).sort()).toEqual(['.trash', 'Board.canvas', 'bin', 'docs', 'notes']);
    expect(run('delete', 'bin/config.json', '--if-match', 'x').body.error.code).toBe('PROTECTED_PATH');
  });
});
