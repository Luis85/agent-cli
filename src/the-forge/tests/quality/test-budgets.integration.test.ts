import { expect, it } from 'vitest';
import { cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runProcess } from '../support/processes.ts';

/** Resolve the configuration exactly as a bare `vitest run <file>` does, with no command-line overrides. */
const resolveProjects = `import { createVitest } from 'vitest/node';
const vitest = await createVitest('test', { watch: false }, {}, {});
const projects = vitest.projects.map(({ name, config }) => ({ name, testTimeout: config.testTimeout, hookTimeout: config.hookTimeout }));
await vitest.close();
process.stdout.write(JSON.stringify(projects));
`;

it('gives every pyramid level the same explicit budgets in a focused run as in npm test', async () => {
  const manifest = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  // The gate adds nothing on the command line, so a focused run resolves the same budgets.
  expect(manifest.scripts.test).toBe('vitest run');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'forge-test-budgets-')));
  try {
    // The same file is the generated project's configuration, so resolve it outside this checkout.
    await cp(resolve('vitest.config.ts'), join(root, 'vitest.config.ts'));
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'junction');
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    const result = await runProcess(process.execPath, ['--input-type=module', '-e', resolveProjects], { cwd: root, timeout: 20_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { name: 'unit', testTimeout: 30_000, hookTimeout: 30_000 },
      { name: 'integration', testTimeout: 30_000, hookTimeout: 30_000 },
      { name: 'e2e', testTimeout: 30_000, hookTimeout: 30_000 },
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
