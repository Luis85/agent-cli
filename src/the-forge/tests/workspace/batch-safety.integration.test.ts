import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { NodeFiles, revisionOf } from '../../src/infrastructure/workspace/files.ts';
import { encodeText } from '../../src/infrastructure/documents/codec.ts';

let root: string, files: NodeFiles;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-batch-safety-')); files = await NodeFiles.at(root); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

const rev = (text: string) => revisionOf(encodeText(text));
async function put(entries: Record<string, string>) {
  for (const [path, text] of Object.entries(entries)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
}
async function walk(directory = root, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) { result.push(prefix + entry.name); continue; }
    const nested = await walk(join(directory, entry.name), `${prefix}${entry.name}/`);
    result.push(...(nested.length ? nested : [`${prefix}${entry.name}/`]));
  }
  return result.sort();
}
type Adapter = {
  stage(target: string, ...args: unknown[]): Promise<string>;
  replace(target: string, ...args: unknown[]): Promise<void>;
  assertRevision(path: string, expected: string | undefined): Promise<void>;
};
const adapter = () => files as unknown as Adapter;

describe('staging before renames', () => {
  it('changes nothing, renames included, when staging a write fails', async () => {
    await put({ 'notes/Old.md': 'Old', 'Index.md': 'Index' });
    const stage = adapter().stage.bind(files);
    vi.spyOn(adapter(), 'stage').mockImplementation(async (target, ...args) => {
      if (basename(target) === 'Index.md') throw Object.assign(new Error('ENOSPC: injected'), { code: 'ENOSPC' });
      return stage(target, ...args);
    });
    await expect(files.commit({
      renames: [{ from: 'notes/Old.md', to: 'deep/New.md', expectedRevision: rev('Old') }],
      writes: [{ path: 'deep/New.md', bytes: encodeText('New'), expectedRevision: rev('Old') }, { path: 'Index.md', bytes: encodeText('Changed'), expectedRevision: rev('Index') }],
    }, false)).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await walk()).toEqual(['Index.md', 'notes/Old.md']);
  });

  it('stages writes into a moved folder inside it, including files in new subfolders', async () => {
    await put({ 'docs/a.md': 'A', 'docs/sub/b.md': 'B' });
    const folder = await files.stat('docs');
    const result = await files.commit({
      renames: [{ from: 'docs', to: 'guides', expectedRevision: folder.revision }],
      writes: [{ path: 'guides/sub/b.md', bytes: encodeText('B2'), expectedRevision: rev('B') }, { path: 'guides/new/deep/c.md', bytes: encodeText('C') }],
    }, false);
    expect(result.changes.map(change => [change.path, change.operation])).toEqual([['guides/sub/b.md', 'updated'], ['guides/new/deep/c.md', 'created']]);
    expect(result.folders).toEqual(['guides/new', 'guides/new/deep']);
    expect(await walk()).toEqual(['guides/a.md', 'guides/new/deep/c.md', 'guides/sub/b.md']);
    expect(await readFile(join(root, 'guides/sub/b.md'), 'utf8')).toBe('B2');
  });

  it('rolls back a folder move and removes writes staged inside it when publishing fails', async () => {
    await put({ 'docs/a.md': 'A', 'docs/sub/b.md': 'B' });
    const folder = await files.stat('docs');
    const replace = adapter().replace.bind(files);
    vi.spyOn(adapter(), 'replace').mockImplementation(async (target, ...args) => {
      if (basename(target) === 'b.md') throw new Error('Injected write failure');
      await replace(target, ...args);
    });
    await expect(files.commit({
      renames: [{ from: 'docs', to: 'guides', expectedRevision: folder.revision }],
      writes: [{ path: 'guides/a.md', bytes: encodeText('A2'), expectedRevision: rev('A') }, { path: 'guides/sub/b.md', bytes: encodeText('B2'), expectedRevision: rev('B') }],
    }, false)).rejects.toThrow('Injected write failure');
    expect(await walk()).toEqual(['docs/a.md', 'docs/sub/b.md']);
    expect(await readFile(join(root, 'docs/a.md'), 'utf8')).toBe('A');
  });
});

describe('rename destinations', () => {
  it('never replaces a destination another program creates after the batch checked it', async () => {
    await put({ 'a.md': 'A' });
    const assertRevision = adapter().assertRevision.bind(files);
    vi.spyOn(adapter(), 'assertRevision').mockImplementation(async (path, expected) => {
      await assertRevision(path, expected);
      if (path === 'a.md') await writeFile(join(root, 'b.md'), 'External');
    });
    await expect(files.commit({ renames: [{ from: 'a.md', to: 'b.md', expectedRevision: rev('A') }] }, false)).rejects.toMatchObject({ code: 'DESTINATION_EXISTS', details: { path: 'b.md', from: 'a.md' } });
    expect(await readFile(join(root, 'b.md'), 'utf8')).toBe('External');
    expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('A');
    expect(await walk()).toEqual(['a.md', 'b.md']);
  });
});

describe('folders with special entries', () => {
  it('covers empty folders, symlinks and node_modules in the folder revision', async () => {
    await put({ 'docs/a.md': 'A' });
    const revisions = [(await files.stat('docs')).revision];
    await mkdir(join(root, 'docs/empty'));
    revisions.push((await files.stat('docs')).revision);
    await symlink('a.md', join(root, 'docs/link.md'));
    revisions.push((await files.stat('docs')).revision);
    await put({ 'docs/node_modules/pkg/index.js': 'x' });
    revisions.push((await files.stat('docs')).revision);
    expect(new Set(revisions).size).toBe(4);
    // node_modules contents are not read.
    await put({ 'docs/node_modules/pkg/index.js': 'y' });
    expect((await files.stat('docs')).revision).toBe(revisions[3]);
  });

  it('refuses to permanently remove folders holding symlinks or node_modules, and reports removed folders', async () => {
    await put({ 'deps/a.md': 'A', 'deps/node_modules/pkg/index.js': 'x', 'links/a.md': 'A', 'plain/a.md': 'A' });
    await mkdir(join(root, 'plain/empty'));
    await symlink('a.md', join(root, 'links/b.md'));
    for (const path of ['deps', 'links']) {
      const { revision } = await files.stat(path);
      await expect(files.commit({ removes: [{ path, expectedRevision: revision }] }, false)).rejects.toMatchObject({ code: 'PROTECTED_PATH', details: { path } });
    }
    const moved = await files.commit({ renames: [{ from: 'links', to: '.trash/links', expectedRevision: (await files.stat('links')).revision }] }, false);
    expect(moved.renames.map(rename => rename.to)).toEqual(['.trash/links', '.trash/links/a.md']);
    const removed = await files.commit({ removes: [{ path: 'plain', expectedRevision: (await files.stat('plain')).revision }] }, false);
    expect(removed).toMatchObject({ changes: [{ path: 'plain/a.md', operation: 'deleted' }], removedFolders: ['plain/empty', 'plain'] });
    expect(await walk()).toEqual(['.trash/links/a.md', '.trash/links/b.md', 'deps/a.md', 'deps/node_modules/pkg/index.js']);
  });
});
