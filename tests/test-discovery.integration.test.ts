import { expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('discovers every labeled test extension in nested folders for its named project', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-test-discovery-'));
  try {
    await cp(resolve('vitest.config.ts'), join(root, 'vitest.config.ts'));
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    const expected: Array<{ file: string; projectName: string }> = [];
    for (const folder of ['nested/cypress/deep', '.hidden/deep', 'dist/deep']) {
      await mkdir(join(root, 'tests', folder), { recursive: true });
      for (const projectName of ['unit', 'integration', 'e2e']) {
        for (const extension of ['ts', 'mts', 'cts', 'tsx', 'js', 'mjs', 'cjs', 'jsx']) {
          const file = `tests/${folder}/example.${projectName}.test.${extension}`;
          await writeFile(join(root, file), 'throw new Error("Discovery must not execute test modules");\n');
          expected.push({ file, projectName });
        }
      }
    }
    await writeFile(join(root, 'tests/unclassified.test.ts'), '');
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/outside.unit.test.ts'), '');
    const result = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'list', '--filesOnly', '--json'], {
      cwd: root, encoding: 'utf8', timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const discovered = (JSON.parse(result.stdout) as Array<{ file: string; projectName: string }>).map(entry => ({
      file: relative(root, entry.file).replaceAll('\\', '/'), projectName: entry.projectName,
    }));
    expect(discovered.sort((a, b) => a.file.localeCompare(b.file))).toEqual(expected.sort((a, b) => a.file.localeCompare(b.file)));
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);
