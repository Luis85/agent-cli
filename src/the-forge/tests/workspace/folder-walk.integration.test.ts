import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { encodeText } from '../../src/infrastructure/documents/codec.ts';

/** Files whose read fails as if another program deleted them between listing and reading. */
const vanishing = new Set<string>();
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (async (path: Parameters<typeof actual.readFile>[0], options?: Parameters<typeof actual.readFile>[1]) => {
      if (typeof path === 'string' && vanishing.has(path)) throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' });
      return actual.readFile(path, options);
    }) as typeof actual.readFile,
  };
});

let root: string, files: NodeFiles;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-folder-walk-')); files = await NodeFiles.at(root); vanishing.clear(); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('folder walks that meet entries Forge cannot read back', () => {
  // Only Linux filesystems store arbitrary name bytes; macOS and Windows refuse such names.
  it.runIf(process.platform === 'linux')('refuses a folder holding a name that is not valid UTF-8 with INVALID_PATH, never a TypeError', async () => {
    await mkdir(join(root, 'dir'));
    await writeFile(Buffer.concat([Buffer.from(join(root, 'dir/')), Buffer.from([0x63, 0x61, 0x66, 0xe9]), Buffer.from('.md')]), 'latin1 name');
    const expected = { code: 'INVALID_PATH', message: expect.stringContaining('not valid UTF-8'), details: { path: 'dir', entry: 'caf�.md' } };
    await expect(files.stat('dir')).rejects.toMatchObject(expected);
    for (const dryRun of [true, false]) {
      await expect(files.commit({ renames: [{ from: 'dir', to: 'dir2', expectedRevision: 'any' }] }, dryRun)).rejects.toMatchObject(expected);
      await expect(files.commit({ removes: [{ path: 'dir', expectedRevision: 'any' }] }, dryRun)).rejects.toMatchObject(expected);
    }
    expect((await readdir(root)).sort()).toEqual(['dir']);
  });

  it('reports a file that disappears during the walk as a CONFLICT', async () => {
    await mkdir(join(root, 'dir/sub'), { recursive: true });
    await writeFile(join(root, 'dir/sub/gone.md'), 'x');
    vanishing.add(join(await files.resolvePath('dir/sub', true), 'gone.md'));
    await expect(files.stat('dir')).rejects.toMatchObject({ code: 'CONFLICT', details: { path: 'dir' } });
    await expect(files.commit({ renames: [{ from: 'dir', to: 'dir2', expectedRevision: 'any' }] }, false)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reports a missing folder as missing', async () => {
    await expect(files.stat('nothing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await files.folder('nothing')).toBeUndefined();
  });
});

describe('filesystem errors as coded path failures', () => {
  // Windows reports an overlong path before the name limit applies.
  it.skipIf(process.platform === 'win32')('refuses a name longer than the filesystem allows without an absolute path in the message', async () => {
    const path = `${'a'.repeat(300)}.md`;
    for (const run of [() => files.writeBatch([{ path, bytes: encodeText('x') }], false), () => files.read(path), () => files.stat(path)]) {
      const error = await run().catch((failure: unknown) => failure) as { code: string; message: string; details: unknown };
      expect(error).toMatchObject({ code: 'INVALID_PATH', details: { path, reason: 'ENAMETOOLONG' } });
      expect(error.message).not.toContain(root);
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('moves a folder below a name that differs only in letter case only where that is another folder', async () => {
    await mkdir(join(root, 'a'));
    await writeFile(join(root, 'a/x.md'), 'x');
    const caseInsensitive = await stat(join(root, 'A')).then(() => true, () => false);
    const { revision } = await files.stat('a');
    const move = files.commit({ renames: [{ from: 'a', to: 'A/b', expectedRevision: revision }] }, false);
    if (caseInsensitive) {
      // A/b is a/b here: the folder would move into itself.
      await expect(move).rejects.toMatchObject({ code: 'INVALID_MOVE', details: { from: 'a', path: 'A/b' } });
      expect(await readdir(join(root, 'a'))).toEqual(['x.md']);
    } else {
      expect((await move).renames[0]).toMatchObject({ from: 'a', to: 'A/b', kind: 'folder' });
      expect(await readdir(join(root, 'A/b'))).toEqual(['x.md']);
    }
  });
});
