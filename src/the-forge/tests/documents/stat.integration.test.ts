import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFiles } from '../../src/infrastructure/workspace/files.ts';
import { statCommand } from '../../src/presentation/documents/stat-command.ts';
import { statOutput } from '../../src/presentation/documents/stat-output.ts';
import { validateJsonValue } from '../../src/domain/schema/json-schema.ts';
import type { CommandContext } from '../../src/application/plugins/registry.ts';

let root: string, files: NodeFiles, context: CommandContext;
const command = statCommand();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-stat-'));
  files = await NodeFiles.at(root);
  context = { workspace: { files, get codec() { throw new Error('stat must not parse content'); } } } as unknown as CommandContext;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const run = (path: string) => command.run([path], {}, context);

describe('stat through the contained file repository', () => {
  it('returns raw revision and size for malformed structured files, binary and invalid UTF-8', async () => {
    const content: Record<string, string | Buffer> = {
      'bad.md': '---\nvalue: [\n---\n', 'bad.canvas': '{"nodes":', 'bad.base': 'views: [',
      'binary.bin': Buffer.from([0, 255, 128]), 'invalid.txt': Buffer.from([255]), 'empty.txt': '',
    };
    for (const [path, bytes] of Object.entries(content)) {
      await writeFile(join(root, path), bytes);
      const raw = await files.read(path);
      const result = await run(path);
      expect(result).toEqual({ path, kind: 'file', revision: raw.revision, bytes: raw.bytes.length });
      expect(validateJsonValue(statOutput, result, 'data').issues).toEqual([]);
      expect(await readFile(join(root, path))).toEqual(Buffer.from(bytes));
    }
  });
  it('counts regular descendants, including empty folders, without listing or following special entries', async () => {
    await mkdir(join(root, 'notes/nested/empty'), { recursive: true });
    await writeFile(join(root, 'notes/a.txt'), 'a'); await writeFile(join(root, 'notes/nested/b.txt'), 'b');
    for (const directory of ['notes/node_modules', 'notes/.git', 'outside']) {
      await mkdir(join(root, directory), { recursive: true }); await writeFile(join(root, directory, 'hidden.txt'), 'hidden');
    }
    await symlink(join(root, 'outside'), join(root, 'notes/linked'), 'junction');
    const expected = await files.stat('notes');
    const result = await run('notes');
    expect(result).toEqual({ path: 'notes', kind: 'folder', revision: expected.revision, fileCount: 2, folderCount: 2 });
    expect(validateJsonValue(statOutput, result, 'data').issues).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('hidden');
    await expect(run('notes/linked/hidden.txt')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });
  it('uses the existing folder revision for child edits, additions, removals and empty folders', async () => {
    await mkdir(join(root, 'notes')); await writeFile(join(root, 'notes/a.txt'), 'a');
    const revision = async () => (await run('notes') as { revision: string }).revision;
    const states = [await revision()];
    await writeFile(join(root, 'notes/a.txt'), 'edited'); states.push(await revision());
    await writeFile(join(root, 'notes/b.txt'), 'b'); states.push(await revision());
    await rm(join(root, 'notes/a.txt')); states.push(await revision());
    await mkdir(join(root, 'notes/empty')); states.push(await revision());
    expect(new Set(states).size).toBe(states.length);
    expect(states.at(-1)).toBe((await files.stat('notes')).revision);
  });
  it.each(['../outside', './notes', '/absolute', 'notes//file', 'notes\\file', '.git/config', '.agent-cli.lock'])('retains path rejection for %s', async path => {
    await expect(run(path)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
  it('retains missing-path errors and rejects a directly selected symlink', async () => {
    await expect(run('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await mkdir(join(root, 'target')); await symlink(join(root, 'target'), join(root, 'link'), 'junction');
    await expect(run('link')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });
});
