import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vaultScope, writeVault } from '../support/vault.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-vault-integrity-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const utf16 = Buffer.from('hi', 'utf16le');

describe('the app facade on bytes that are not UTF-8 text', () => {
  it.each([['latin1.md', latin1], ['pic.png', png], ['data.txt', utf16]])('refuses append, process and read of %s and keeps its bytes', async (path, bytes) => {
    await writeFile(join(root, path), bytes);
    const { app, records } = await vaultScope(root);
    await expect(app.vault.append(path, 'more\n')).rejects.toMatchObject({ code: 'INVALID_ENCODING' });
    await expect(app.vault.process(path, text => `${text}more`)).rejects.toMatchObject({ code: 'INVALID_ENCODING' });
    await expect(app.vault.read(path)).rejects.toMatchObject({ code: 'INVALID_ENCODING' });
    expect(await readFile(join(root, path))).toEqual(bytes);
    expect(records()).toEqual([]);
  });

  it('still appends to UTF-8 text with a byte order mark', async () => {
    await writeFile(join(root, 'bom.md'), '﻿café\n');
    const { app } = await vaultScope(root);
    await app.vault.append('bom.md', 'more\n');
    expect(await readFile(join(root, 'bom.md'), 'utf8')).toBe('﻿café\nmore\n');
  });
});

describe('trashing below a trash entry that is a file', () => {
  it('trashes into a numbered folder when .trash/<parent> is a file trashed earlier', async () => {
    await writeVault(root, { ideas: 'an extensionless note', 'keep.md': 'k' });
    const { app, files } = await vaultScope(root);
    expect((await app.fileManager.delete('ideas', { ifMatch: (await files.read('ideas')).revision })).trashPath).toBe('.trash/ideas');
    await writeVault(root, { 'ideas/a.md': 'a', 'ideas/b.md': 'b' });
    const first = await app.fileManager.delete('ideas/a.md', { ifMatch: (await files.read('ideas/a.md')).revision });
    expect(first.trashPath).toBe('.trash/ideas 1/a.md');
    expect(await readFile(join(root, '.trash/ideas 1/a.md'), 'utf8')).toBe('a');
    const second = await app.fileManager.delete('ideas/b.md', { ifMatch: (await files.read('ideas/b.md')).revision });
    expect(second.trashPath).toBe('.trash/ideas 1/b.md');
    expect(await readFile(join(root, '.trash/ideas'), 'utf8')).toBe('an extensionless note');
  });

  it('passes several file ancestors at different depths', async () => {
    await mkdir(join(root, '.trash/a/b 1'), { recursive: true });
    await writeVault(root, { '.trash/a/b': 'file', '.trash/x': 'file', '.trash/x 1': 'file', 'a/b/c.md': 'c', 'x/y.md': 'y' });
    const { app, files } = await vaultScope(root);
    expect((await app.fileManager.delete('a/b/c.md', { ifMatch: (await files.read('a/b/c.md')).revision })).trashPath).toBe('.trash/a/b 1/c.md');
    const folder = await files.stat('x');
    expect((await app.fileManager.delete('x', { ifMatch: folder.revision, recursive: true })).trashPath).toBe('.trash/x 2');
    expect(await readFile(join(root, '.trash/x 2/y.md'), 'utf8')).toBe('y');
  });
});

describe('parallel writes in one process', () => {
  it('queues commits on the writer lock instead of failing with WORKSPACE_BUSY', async () => {
    const paths = Array.from({ length: 8 }, (_, index) => `notes/n${index}.md`);
    await writeVault(root, Object.fromEntries(paths.map(path => [path, 'old\n'])));
    const { app } = await vaultScope(root);
    const results = await Promise.allSettled(paths.map(path => app.vault.modify(path, `new ${path}\n`)));
    expect(results.map(result => result.status)).toEqual(paths.map(() => 'fulfilled'));
    for (const path of paths) expect(await readFile(join(root, path), 'utf8')).toBe(`new ${path}\n`);
  });

  it('keeps a failing commit from blocking the ones queued behind it', async () => {
    await writeVault(root, { 'a.md': 'a', 'b.md': 'b' });
    const { app } = await vaultScope(root);
    const [stale, fresh] = await Promise.allSettled([app.vault.modify('a.md', 'x', { ifMatch: 'stale' }), app.vault.modify('b.md', 'y')]);
    expect(stale).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
    expect(fresh.status).toBe('fulfilled');
    expect(await readFile(join(root, 'b.md'), 'utf8')).toBe('y');
  });
});
