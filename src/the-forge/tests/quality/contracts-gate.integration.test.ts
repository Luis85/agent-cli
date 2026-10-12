import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

it('stops the full gate before building when a selected source contract fails', async () => {
  const { scripts } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const selection = /^vitest run (.+)$/.exec(scripts['check:contracts']);
  expect(selection).not.toBeNull();
  const suites = selection![1]!.split(' ');
  expect(suites).toHaveLength(7);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'forge-contract-gate-')));
  try {
    await cp(resolve('vitest.config.ts'), join(root, 'vitest.config.ts'));
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'junction');
    const stages = ['check:structure', 'lint', 'analyze', 'typecheck', 'build', 'test', 'showcase:check'];
    const fixtureScripts = { ...scripts };
    for (const stage of stages) fixtureScripts[stage] = `node stage.mjs ${stage}`;
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: fixtureScripts }));
    await writeFile(join(root, 'stage.mjs'), "import { appendFileSync } from 'node:fs'; appendFileSync('stages.txt', process.argv[2] + '\\n');\n");
    for (const [index, path] of suites.entries()) {
      expect(path).toMatch(/^tests\/[a-z/-]+\.(?:unit|integration)\.test\.ts$/);
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), `import { expect, it } from 'vitest'; it('source-contract-fault', () => expect(${index === 0}).toBe(false));\n`);
    }
    // Exercise the real script chain with an actual failing Vitest assertion, without building an artifact.
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check'], {
      cwd: root, encoding: 'utf8', shell: process.platform === 'win32', timeout: 20_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('source-contract-fault');
    expect((await readFile(join(root, 'stages.txt'), 'utf8')).trim().split('\n')).toEqual(stages.slice(0, 4));
  } finally { await rm(root, { recursive: true, force: true }); }
});
