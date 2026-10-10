import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vaultScope, writeVault } from '../support/vault.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-file-manager-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const text = (path: string) => readFile(join(root, path), 'utf8');
const board = (file: string) => `{"nodes":[{"id":"n1","type":"file","file":"${file}","subpath":"#Goals","x":0,"y":0,"width":100,"height":100}],"edges":[]}\n`;
const vault = {
  'Index.md': '---\nrelated: "[[Plan]]"\n---\n# Index\n\nSee [[Plan#Goals|goals]] and [spec](notes/Plan.md).\n',
  'notes/Plan.md': '# Plan\n\n## Goals\n\nBack to [index](../Index.md).\n',
  'Board.canvas': board('notes/Plan.md'),
};

describe('moving notes with link updates', () => {
  it('renames a note referenced from frontmatter, body text and a Canvas file in one batch', async () => {
    await writeVault(root, vault);
    const { app, files, metadata, records } = await vaultScope(root);
    const { revision } = await files.read('notes/Plan.md');
    const result = await app.fileManager.rename('notes/Plan.md', 'Roadmap', { ifMatch: revision });
    expect(result).toMatchObject({ dryRun: false, from: 'notes/Plan.md', to: 'notes/Roadmap.md', kind: 'file', links: { updated: 4, files: 2, unrewritten: [] } });
    expect(await text('Index.md')).toBe('---\nrelated: "[[Roadmap]]"\n---\n# Index\n\nSee [[Roadmap#Goals|goals]] and [spec](notes/Roadmap.md).\n');
    expect(await text('Board.canvas')).toBe(board('notes/Roadmap.md'));
    expect(await text('notes/Roadmap.md')).toBe(vault['notes/Plan.md']);
    expect(records()).toEqual([
      ['vault.rename', 'notes/Roadmap.md'], ['vault.modify', 'Board.canvas'], ['vault.modify', 'Index.md'],
      ['metadataCache.changed', 'Board.canvas'], ['metadataCache.changed', 'Index.md'],
      ['metadataCache.resolve', 'Board.canvas'], ['metadataCache.resolve', 'Index.md'], ['metadataCache.resolve', 'notes/Roadmap.md'],
      ['metadataCache.resolved', undefined],
    ]);
    const cache = await metadata.load();
    expect(Object.values(cache.unresolvedLinks).every(links => Object.keys(links).length === 0)).toBe(true);
    expect(cache.resolvedLinks['Index.md']).toEqual({ 'notes/Roadmap.md': 3 });
  });

  it('previews every rewritten file with diffs and changes nothing in a dry run', async () => {
    await writeVault(root, vault);
    const { app, files, records } = await vaultScope(root, { dryRun: true });
    const { revision } = await files.read('notes/Plan.md');
    const preview = await app.fileManager.move('notes/Plan.md', 'specs/Plan.md', { ifMatch: revision });
    expect(preview.changes.map(change => [change.path, 'diff' in change && typeof change.diff])).toEqual([['Board.canvas', 'string'], ['Index.md', 'string']]);
    expect(preview.changes[1]).toMatchObject({ diff: expect.stringContaining('-See [[Plan#Goals|goals]] and [spec](notes/Plan.md).\n+See [[Plan#Goals|goals]] and [spec](specs/Plan.md).') });
    expect(records()).toEqual([]);
    expect((await readdir(root)).sort()).toEqual(['Board.canvas', 'Index.md', 'notes']);
  });

  it('moves folders, keeps links intact and refuses existing destinations or stale revisions', async () => {
    await writeVault(root, { ...vault, 'notes/sub/Detail.md': '[[Plan]]', 'specs/Existing.md': 'x' });
    const { app, files, metadata } = await vaultScope(root);
    const folder = await files.stat('notes');
    await expect(app.fileManager.move('notes', 'specs', { ifMatch: folder.revision })).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' });
    await expect(app.fileManager.move('notes', 'notes/inner', { ifMatch: folder.revision })).rejects.toMatchObject({ code: 'INVALID_MOVE' });
    await expect(app.fileManager.move('notes', 'archive/notes', { ifMatch: 'stale' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const moved = await app.fileManager.move('notes', 'archive/notes', { ifMatch: folder.revision });
    expect(moved.renames.map(rename => [rename.kind, rename.to])).toEqual([
      ['folder', 'archive/notes'], ['file', 'archive/notes/Plan.md'], ['folder', 'archive/notes/sub'], ['file', 'archive/notes/sub/Detail.md'],
    ]);
    expect(await text('Index.md')).toContain('[spec](archive/notes/Plan.md)');
    expect(await text('archive/notes/Plan.md')).toContain('[index](../../Index.md)');
    const cache = await metadata.load();
    expect(Object.values(cache.unresolvedLinks).every(links => Object.keys(links).length === 0)).toBe(true);
  });

  it('rewrites quoted frontmatter, table-escaped and nested links without conflicts', async () => {
    await writeVault(root, {
      'Note.md': 'note', 'F/a.png': 'png',
      'n.md': "---\nup: '[[Note]]'\nsame: \"[[Note]]\"\n---\n| x | [[Note\\|alias]] |\n\n[about [[Note]]](Note.md) [![t](F/a.png)](Note.md)\n",
    });
    const { app } = await vaultScope(root);
    const result = await app.fileManager.rename('Note.md', "Bob's Note");
    expect(result.links).toEqual({ updated: 6, files: 1, unrewritten: [] });
    expect(await text('n.md')).toBe("---\nup: '[[Bob''s Note]]'\nsame: \"[[Bob's Note]]\"\n---\n| x | [[Bob's Note\\|alias]] |\n\n[about [[Bob's Note]]](Bob's%20Note.md) [![t](F/a.png)](Bob's%20Note.md)\n");
  });

  it('refuses protected paths and invalid renames', async () => {
    await writeVault(root, { 'bin/forge.js': 'x', '.obsidian/app.json': '{}', 'a.md': 'A' });
    const { app } = await vaultScope(root);
    await expect(app.fileManager.move('bin/forge.js', 'forge.js')).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(app.fileManager.delete('.obsidian/app.json', { permanent: true })).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(app.fileManager.move('a.md', '.obsidian/a.md')).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(app.fileManager.move('a.md', '.Obsidian/a.md')).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(app.fileManager.move('a.md', 'BIN/a.md')).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(app.fileManager.delete('.FORGE', { recursive: true, permanent: true })).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
    await expect(app.fileManager.rename('a.md', 'x/b')).rejects.toMatchObject({ code: 'INVALID_MOVE' });
    await expect(app.fileManager.move('a.md', 'a.md')).rejects.toMatchObject({ code: 'INVALID_MOVE' });
    const { app: projectApp } = await vaultScope(root, { project: { schemaVersion: 1, name: 'p', type: 'library', directory: 'src/p' } });
    expect(await projectApp.fileManager.move('bin/forge.js', 'tools/forge.js')).toMatchObject({ to: 'tools/forge.js' });
  });
});

describe('deleting files and folders', () => {
  it('refuses while other files link to a note, then moves it to the trash with numbered copies', async () => {
    await writeVault(root, { ...vault, '.trash/notes/Plan.md': 'older copy' });
    const { app, files, records } = await vaultScope(root);
    const { revision } = await files.read('notes/Plan.md');
    const refused = app.fileManager.delete('notes/Plan.md', { ifMatch: revision });
    await expect(refused).rejects.toMatchObject({ code: 'HAS_BACKLINKS', exitCode: 2 });
    const details = await refused.catch((error: { details: { backlinks: unknown[] } }) => error.details.backlinks);
    expect(details).toEqual([
      { source: 'Board.canvas', target: 'notes/Plan.md', kind: 'canvas', line: null, original: 'notes/Plan.md', node: 'n1' },
      { source: 'Index.md', target: 'notes/Plan.md', kind: 'link', line: 6, original: '[[Plan#Goals|goals]]' },
      { source: 'Index.md', target: 'notes/Plan.md', kind: 'link', line: 6, original: '[spec](notes/Plan.md)' },
      { source: 'Index.md', target: 'notes/Plan.md', kind: 'frontmatter', line: null, original: '[[Plan]]', key: 'related' },
    ]);
    const deleted = await app.fileManager.delete('notes/Plan.md', { ifMatch: revision, allowBrokenLinks: true });
    expect(deleted).toMatchObject({ permanent: false, trashPath: '.trash/notes/Plan 1.md', deleted: [{ path: 'notes/Plan.md', kind: 'file', revision }], brokenLinks: details });
    expect(await text('.trash/notes/Plan 1.md')).toBe(vault['notes/Plan.md']);
    expect(records()).toEqual([['vault.delete', 'notes/Plan.md'], ['metadataCache.deleted', 'notes/Plan.md'], ['metadataCache.resolve', 'Board.canvas'], ['metadataCache.resolve', 'Index.md'], ['metadataCache.resolved', undefined]]);
  });

  it('reports every trashed file and folder, child folders before their parents', async () => {
    await writeVault(root, { 'docs/a.md': 'A', 'docs/sub/b.md': 'B' });
    const { app, files } = await vaultScope(root);
    const trashed = await app.fileManager.delete('docs', { ifMatch: (await files.stat('docs')).revision, recursive: true });
    expect(trashed.deleted).toEqual([
      { path: 'docs/a.md', kind: 'file', revision: expect.any(String), bytes: 1 }, { path: 'docs/sub/b.md', kind: 'file', revision: expect.any(String), bytes: 1 },
      { path: 'docs/sub', kind: 'folder' }, { path: 'docs', kind: 'folder' },
    ]);
  });

  it('counts table-escaped wikilinks as links into a deleted note', async () => {
    await writeVault(root, { 'Note.md': 'note', 'Table.md': '| a |\n| --- |\n| [[Note\\|alias]] |\n' });
    const { app } = await vaultScope(root);
    await expect(app.fileManager.delete('Note.md')).rejects.toMatchObject({
      code: 'HAS_BACKLINKS', details: { backlinks: [{ source: 'Table.md', target: 'Note.md', kind: 'link', line: 3, original: '[[Note\\|alias]]' }] },
    });
  });

  it('deletes folders recursively, checking only links from outside them', async () => {
    await writeVault(root, { 'docs/a.md': '[[b]]', 'docs/b.md': 'B', 'Index.md': '[[a]]', '.trash/old.md': 'x', '.Trash/new.md': 'y' });
    const { app, files } = await vaultScope(root);
    const folder = await files.stat('docs');
    await expect(app.fileManager.delete('docs', { ifMatch: folder.revision })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(app.fileManager.delete('docs', { ifMatch: folder.revision, recursive: true })).rejects.toMatchObject({ code: 'HAS_BACKLINKS', details: { backlinks: [expect.objectContaining({ source: 'Index.md', target: 'docs/a.md' })] } });
    await expect(app.fileManager.delete('.trash/old.md', {})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(app.fileManager.delete('.Trash/new.md', {})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const removed = await app.fileManager.delete('docs', { ifMatch: folder.revision, recursive: true, permanent: true, allowBrokenLinks: true });
    expect(removed).toMatchObject({ permanent: true, trashPath: null, deleted: [{ path: 'docs/a.md', kind: 'file' }, { path: 'docs/b.md', kind: 'file' }, { path: 'docs', kind: 'folder' }] });
    expect((await readdir(root)).filter(name => name !== '.Trash').sort()).toEqual(['.trash', 'Index.md']);
    expect(await app.fileManager.delete('.trash/old.md', { permanent: true })).toMatchObject({ deleted: [{ path: '.trash/old.md' }] });
  });
});

describe('processFrontMatter', () => {
  it('sets and removes properties atomically while preserving the body', async () => {
    await writeVault(root, { 'Note.md': '---\ntitle: Old # keep comment\ntags: [a]\ndraft: true\n---\nBody [[Link]]\n' });
    const { app, files } = await vaultScope(root);
    await app.fileManager.processFrontMatter('Note.md', frontmatter => {
      frontmatter.title = 'New';
      delete frontmatter.draft;
      (frontmatter.tags as string[]).push('b');
    });
    // Changed values are re-serialized like `properties --set`; untouched keys and comments keep their text.
    expect(await text('Note.md')).toBe('---\ntitle: New # keep comment\ntags:\n  - a\n  - b\n---\nBody [[Link]]\n');
    await expect(app.fileManager.processFrontMatter('Note.md', () => {}, { ifMatch: 'stale' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await app.fileManager.processFrontMatter('Note.md', frontmatter => { frontmatter.title = 'New'; })).toEqual({ dryRun: false, changes: [] });
    await expect(app.fileManager.processFrontMatter('Board.canvas', () => {})).rejects.toMatchObject({ code: 'UNSUPPORTED_EDIT' });
    expect((await files.read('Note.md')).revision).toBeTypeOf('string');
  });
});
