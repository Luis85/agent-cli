import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFiles, stampedFiles } from '../../src/infrastructure/workspace/files.ts';

let root: string, files: NodeFiles;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'forge-reserved-')); files = await NodeFiles.at(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function put(path: string, text = 'keep') {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), text);
}

it.each([false, true])('protects nested Git metadata regardless of letter case (dry run: %s)', async dryRun => {
  await put('repo/.GiT/HEAD', 'ref: refs/heads/main');
  await put('repo/note.md');
  const { revision } = await files.stat('repo');
  await expect(files.commit({ removes: [{ path: 'repo', expectedRevision: revision }] }, dryRun)).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
  await expect(files.commit({ renames: [{ from: 'repo', to: 'moved', expectedRevision: revision }] }, dryRun)).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
  expect(await readFile(join(root, 'repo/.GiT/HEAD'), 'utf8')).toBe('ref: refs/heads/main');
  expect(await readdir(root)).toEqual(['repo']);
});

it('omits case variants of reserved entries, dependencies and derived cache from both listings', async () => {
  for (const path of ['.GiT/HEAD', 'nested/.AGENT-CLI.LOCK', '.AGENT-CLI-TMP-staged', 'NODE_MODULES/pkg/index.js', '.FoRgE/CaChE/snapshot.json', 'note.md']) await put(path);
  expect(await files.list()).toEqual(['note.md']);
  expect((await stampedFiles(files)).files.map(file => file.path)).toEqual(['note.md']);
});

it('protects dependencies from recursive deletion regardless of letter case', async () => {
  await put('project/NODE_MODULES/pkg/index.js');
  const { revision } = await files.stat('project');
  await expect(files.commit({ removes: [{ path: 'project', expectedRevision: revision }] }, false)).rejects.toMatchObject({ code: 'PROTECTED_PATH' });
  expect(await readFile(join(root, 'project/NODE_MODULES/pkg/index.js'), 'utf8')).toBe('keep');
});
