import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScopedFiles } from '../src/application/scoped-files.ts';
import { NodeFiles, revisionOf } from '../src/infrastructure/files.ts';
import type { WriteRequest } from '../src/domain/file.ts';

const bytes = (text: string) => new TextEncoder().encode(text);
const write = (path: string, content = 'Original') => ({ path, bytes: bytes(content) });
let root: string, files: NodeFiles, project: ScopedFiles;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'forge-scoped-'));
  files = await NodeFiles.at(root);
  project = new ScopedFiles(files, 'src/alpha');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('reads, lists and writes project-relative paths without exposing siblings', async () => {
  await files.writeBatch([write('src/alpha/note.md'), write('src/alpha/deep/file.bin'), write('src/alpha-extra/hidden.md'), write('src/beta/hidden.md'), write('root.md')], false);
  expect(await project.list()).toEqual(['deep/file.bin', 'note.md']);
  expect(await project.read('note.md')).toEqual({ path: 'note.md', bytes: Buffer.from('Original'), revision: revisionOf(bytes('Original')) });
  expect(await project.writeBatch([write('new.md')], false)).toEqual([{ path: 'new.md', operation: 'created', bytes: 8, revision: revisionOf(bytes('Original')) }]);
  expect(await readFile(join(root, 'src/alpha/new.md'), 'utf8')).toBe('Original');
  expect(await files.list()).toContain('src/beta/hidden.md');
});

it('preserves revisions and rejects collisions before committing a batch', async () => {
  await project.writeBatch([write('note.md')], false);
  const initial = await project.read('note.md');
  await expect(project.writeBatch([write('new.md'), write('note.md', 'Changed')], false)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await project.list()).toEqual(['note.md']);
  expect(await project.writeBatch([{ ...write('note.md', 'Changed'), expectedRevision: initial.revision }], false)).toMatchObject([{ path: 'note.md', operation: 'updated' }]);
  await expect(project.writeBatch([{ ...write('note.md'), expectedRevision: initial.revision }], false)).rejects.toMatchObject({ code: 'CONFLICT' });
  for (const plan of [[], [write('same.md'), write('same.md')], [write('file'), write('file/nested')]]) {
    await expect(project.writeBatch(plan, false)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  }
});

it('dry runs leave the complete root untouched and predict relative results', async () => {
  const preview = await project.writeBatch([write('new/deep.md')], true);
  expect(await readdir(root)).toEqual([]);
  expect(preview).toMatchObject([{ path: 'new/deep.md', operation: 'created' }]);
  expect(await project.writeBatch([write('new/deep.md')], false)).toEqual(preview);
});

it.each(['../beta/hidden.md', '/outside.md', 'a/../../outside.md', 'a\\b.md', '.git/config', '.agent-cli.lock'])('rejects unsafe project-relative path %s before prefixing', async path => {
  await expect(project.read(path)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  await expect(project.writeBatch([write(path)], false)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  expect(await readdir(root)).toEqual([]);
});

it.each(['', '../other', '/absolute', 'src/../other', 'src/.git'])('rejects unsafe project directory %s', directory => {
  expect(() => new ScopedFiles(files, directory)).toThrowError(expect.objectContaining({ code: 'INVALID_PATH' }));
});

it('uses the root writer lock for every selected project', async () => {
  await writeFile(join(root, '.agent-cli.lock'), 'existing owner');
  await expect(project.writeBatch([write('note.md')], false)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
  await expect(new ScopedFiles(files, 'src/beta').writeBatch([write('note.md')], false)).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
  expect(await readdir(root)).toEqual(['.agent-cli.lock']);
  expect(await readFile(join(root, '.agent-cli.lock'), 'utf8')).toBe('existing owner');
});

it('rejects symlinked project roots and nested links through the parent repository', async () => {
  await files.writeBatch([write('src/beta/secret.md')], false);
  await symlink(join(root, 'src/beta'), join(root, 'src/alpha'));
  await expect(project.read('secret.md')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  await expect(project.writeBatch([write('new.md')], false)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  expect(await project.list()).toEqual([]);
  await rm(join(root, 'src/alpha'));
  await mkdir(join(root, 'src/alpha'));
  await symlink(join(root, 'src/beta'), join(root, 'src/alpha/link'));
  await expect(project.read('link/secret.md')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  await expect(project.writeBatch([write('link/new.md')], true)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  expect(await project.list()).toEqual([]);
  expect(await files.read('src/beta/secret.md')).toMatchObject({ bytes: Buffer.from('Original') });
});

it.each([false, true])('rejects malformed JavaScript plans before mapping (dry run: %s)', async dryRun => {
  for (const plan of [null, {}, [null], Array(1), [{ bytes: bytes('test') }], [{ path: 'asset.bin', bytes: 'hello' }], [{ path: 'asset.bin', bytes: [256, -1] }], [{ ...write('note.md'), expectedRevision: 42 }]]) {
    await expect(project.writeBatch(plan as unknown as WriteRequest[], dryRun)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  }
  expect(await readdir(root)).toEqual([]);
});

it('snapshots caller plans before an asynchronous repository consumes them', async () => {
  const deferred = new ScopedFiles({
    read: path => files.read(path),
    list: () => files.list(),
    async writeBatch(writes, dryRun) { await Promise.resolve(); return files.writeBatch(writes, dryRun); },
  }, 'src/alpha');
  const request = write('original.md'), plan = [request];
  const operation = deferred.writeBatch(plan, false);
  request.path = '../beta/changed.md';
  request.bytes.fill(0);
  plan.push(write('extra.md'));
  expect(await operation).toMatchObject([{ path: 'original.md', revision: revisionOf(bytes('Original')) }]);
  expect(await files.list()).toEqual(['src/alpha/original.md']);
  expect(await readFile(join(root, 'src/alpha/original.md'), 'utf8')).toBe('Original');
});
