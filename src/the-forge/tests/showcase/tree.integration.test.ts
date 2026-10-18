import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compareTrees, listFiles } from '../../scripts/showcase/tree.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function tree(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'forge-showcase-tree-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

it('leaves the derived metadata cache of commands run against the showcase out of the drift check', async () => {
  const committed = { '.forge/project.json': '{}', 'Home.md': '# Home\n' };
  const expected = await tree(committed);
  // A command run with --root on the showcase stores its self-ignoring metadata cache there.
  const actual = await tree({ ...committed, '.forge/cache/.gitignore': '*\n', '.forge/cache/metadata.v2.workspace.json': '{}' });
  expect(listFiles(actual)).toEqual(['.forge/project.json', 'Home.md']);
  expect(compareTrees(expected, actual, [])).toEqual([]);
  // Anything else under .forge still counts.
  const other = await tree({ ...committed, '.forge/sync/contoso.json': '{}' });
  expect(compareTrees(expected, other, [])).toEqual([{ path: '.forge/sync/contoso.json', status: 'unexpected' }]);
});
