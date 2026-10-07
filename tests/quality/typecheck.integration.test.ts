import { expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('rejects type errors in every accepted test extension even when runtime assertions pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-typechecked-tests-'));
  try {
    await cp(resolve('tsconfig.json'), join(root, 'tsconfig.json'));
    await cp(resolve('vitest.config.ts'), join(root, 'vitest.config.ts'));
    await cp(resolve('src/infrastructure/scripts/quality'), join(root, 'src/infrastructure/scripts/quality'), { recursive: true });
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { scripts: { typecheck: string } };
    await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { typecheck: manifest.scripts.typecheck } }));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/index.ts'), 'export const source = true;\n');
    const cases: Array<{ file: string; content: string }> = [];
    for (const folder of ['nested/cypress', '.hidden/deep', 'dist/deep']) {
      await mkdir(join(root, 'tests', folder), { recursive: true });
      for (const extension of ['ts', 'mts', 'cts', 'tsx', 'js', 'mjs', 'cjs', 'jsx']) {
        // Identical basenames also exercise TypeScript's normal .ts-over-.js discovery preference.
        const file = `tests/${folder}/typed.unit.test.${extension}`;
        const content = extension.includes('t')
          ? 'export const wrong: string = 42;\n'
          : '/** @type {string} */\nexport const wrong = 42;\n';
        cases.push({ file, content });
        await writeFile(join(root, file), content);
      }
    }
    const runtimeFile = 'tests/runtime.unit.test.ts';
    const runtime = "import { expect, it } from 'vitest';\nit('passes runtime assertions despite a static error', () => { const value: string = 42; expect(String(value)).toBe('42'); });\n";
    cases.push({ file: runtimeFile, content: runtime });
    await writeFile(join(root, runtimeFile), runtime);
    const transpiled = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', runtimeFile], { cwd: root, encoding: 'utf8', timeout: 20_000 });
    expect(transpiled.error).toBeUndefined();
    expect(transpiled.status, transpiled.stdout + transpiled.stderr).toBe(0);

    const typecheck = () => spawnSync('npm', ['run', 'typecheck', '--', '--pretty', 'false'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
    const invalid = typecheck();
    expect(invalid.error).toBeUndefined();
    expect(invalid.status).not.toBe(0);
    for (const { file } of cases) expect(invalid.stdout + invalid.stderr).toContain(file);
    expect(invalid.stdout + invalid.stderr).toContain('TS2322');
    for (const { file, content } of cases) await writeFile(join(root, file), content.replace('= 42', "= '42'"));
    const repaired = typecheck();
    expect(repaired.error).toBeUndefined();
    expect(repaired.status, repaired.stdout + repaired.stderr).toBe(0);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
