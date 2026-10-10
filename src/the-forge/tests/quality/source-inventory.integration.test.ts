import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceFiles } from '../../scripts/quality/shared.mjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function put(root: string, path: string, content = 'export {};\n') {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
async function fixture(config?: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'forge-source-scope-'));
  roots.push(root);
  await put(root, 'src/the-forge/main.ts');
  if (config !== undefined) await put(root, 'configs/quality/source.json', JSON.stringify(config));
  return root;
}

describe('explicit project source inventory', () => {
  it('selects the configured subtree and retains tests, tooling, examples and root configuration source', async () => {
    const root = await fixture({ sourceRoot: 'src/the-forge', additionalRoots: ['docs/examples'] });
    for (const path of ['src/the-forge/domain/model.ts', 'tests/source.unit.test.ts', 'scripts/check.mjs', 'docs/examples/plugin/main.mjs', 'vite.config.ts']) await put(root, path);
    await put(root, 'src/other-project/index.ts', 'invalid source ignored');
    await put(root, 'src/the-forge/.forge-project.json', '{"name":"the-forge"}');
    await symlink('/missing', join(root, 'src/other-project/node_modules'), 'dir');
    expect(sourceFiles(root)).toEqual([
      'docs/examples/plugin/main.mjs', 'scripts/check.mjs', 'src/the-forge/domain/model.ts',
      'src/the-forge/main.ts', 'tests/source.unit.test.ts', 'vite.config.ts',
    ]);
  });

  it('defaults to src for generated projects without configuration', async () => {
    const root = await fixture();
    await put(root, 'src/index.ts');
    expect(sourceFiles(root)).toEqual(['src/index.ts', 'src/the-forge/main.ts']);
  });

  it('includes authored documentation examples and template code only through explicit additional roots', async () => {
    const root = await fixture({ sourceRoot: 'src/the-forge', additionalRoots: ['docs/examples', 'docs/templates'] });
    await put(root, 'docs/examples/plugins/demo/main.mjs');
    await put(root, 'docs/templates/projects/form-model.ts');
    await put(root, 'docs/unselected/broken.ts', 'not source');
    expect(sourceFiles(root)).toEqual(['docs/examples/plugins/demo/main.mjs', 'docs/templates/projects/form-model.ts', 'src/the-forge/main.ts']);
    await put(root, 'configs/quality/source.json', JSON.stringify({ sourceRoot: 'src/the-forge', additionalRoots: [] }));
    expect(sourceFiles(root)).toEqual(['src/the-forge/main.ts']);
  });

  it.each([
    'docs', [1], ['/docs'], ['docs/../outside'], ['docs//examples'],
    ['docs', 'docs/templates'], ['docs/examples', 'docs/examples'], ['src/the-forge'],
  ].map(additionalRoots => [additionalRoots]))('rejects unsafe or overlapping additional source roots %j', async additionalRoots => {
    const root = await fixture({ sourceRoot: 'src/the-forge', additionalRoots });
    expect(() => sourceFiles(root)).toThrow(/additionalRoots|Source inventory roots/);
  });

  it('reports a missing required authored asset root', async () => {
    const root = await fixture({ sourceRoot: 'src/the-forge', additionalRoots: ['docs/templates'] });
    expect(() => sourceFiles(root)).toThrow('Required source directory docs/templates is missing');
  });

  it.each([
    null, [], {}, { sourceRoot: 1 }, { sourceRoot: 'src', ignored: true },
    { sourceRoot: '' }, { sourceRoot: '/src' }, { sourceRoot: 'src/../outside' },
    { sourceRoot: 'src//nested' }, { sourceRoot: 'src\\nested' }, { sourceRoot: 'src/.' },
    { sourceRoot: 'outside' }, { sourceRoot: 'src/\u0000' },
  ].map(config => [config]))('rejects malformed or uncontained inventory configuration %j', async config => {
    const root = await fixture(config);
    expect(() => sourceFiles(root)).toThrow(/sourceRoot/);
  });

  it('reports invalid JSON and missing or empty required source scope', async () => {
    const root = await fixture({ sourceRoot: 'src/missing' });
    expect(() => sourceFiles(root)).toThrow('Required source directory src/missing is missing');
    await mkdir(join(root, 'src/missing'));
    expect(() => sourceFiles(root)).toThrow('Source inventory is empty: src/missing');
    await put(root, 'configs/quality/source.json', '{');
    expect(() => sourceFiles(root)).toThrow('Cannot read source inventory configuration');
  });

  it('rejects symlinked selected roots, ancestors and files', async () => {
    const root = await fixture({ sourceRoot: 'src/link' });
    await symlink(join(root, 'src/the-forge'), join(root, 'src/link'), 'dir');
    expect(() => sourceFiles(root)).toThrow('Source scope contains a symbolic link');
    await put(root, 'configs/quality/source.json', JSON.stringify({ sourceRoot: 'src/link/nested' }));
    expect(() => sourceFiles(root)).toThrow('Source scope contains a symbolic link');
    await put(root, 'configs/quality/source.json', JSON.stringify({ sourceRoot: 'src/the-forge' }));
    await symlink('/missing', join(root, 'src/the-forge/link.ts'));
    expect(() => sourceFiles(root)).toThrow('Source scope contains a symbolic link');
  });
});
