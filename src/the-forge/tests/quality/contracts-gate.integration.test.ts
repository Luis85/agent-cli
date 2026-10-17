import { expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runProcess } from '../support/processes.ts';

const npmStep = /^npm (?:run )?([\w:-]+)$/;

/** The leaf stages a script runs in order: a script made only of `npm run` steps expands into theirs. */
function stagesOf(scripts: Record<string, string>, name: string): string[] {
  const steps = scripts[name]!.split('&&').map(step => step.trim());
  if (!steps.every(step => npmStep.test(step))) return [name];
  return steps.flatMap(step => stagesOf(scripts, npmStep.exec(step)![1]!));
}

it('stops the full gate before building when a selected source contract fails, and ends it with the showcase drift check', async () => {
  const { scripts } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const selection = /^vitest run (.+)$/.exec(scripts['check:contracts']);
  expect(selection).not.toBeNull();
  const suites = selection![1]!.split(' ');
  expect(suites.length).toBeGreaterThan(0);
  const order = stagesOf(scripts, 'check');
  const contracts = order.indexOf('check:contracts');
  expect(contracts).toBeGreaterThan(-1);
  expect(order.indexOf('build')).toBeGreaterThan(contracts);
  // The showcase drift check runs alone, after the test suite.
  expect(order.at(-1)).toBe('showcase:check');
  expect(scripts['showcase:check']).toBe('node scripts/showcase.mjs --check');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'forge-contract-gate-')));
  try {
    await cp(resolve('vitest.config.ts'), join(root, 'vitest.config.ts'));
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'junction');
    const stages = order.filter(stage => stage !== 'check:contracts');
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
    const result = await runProcess(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check'], {
      cwd: root, shell: process.platform === 'win32', timeout: 20_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('source-contract-fault');
    expect((await readFile(join(root, 'stages.txt'), 'utf8')).trim().split('\n')).toEqual(order.slice(0, contracts));
  } finally { await rm(root, { recursive: true, force: true }); }
});
