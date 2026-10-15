import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileFilter, strykerPlugins } from '../../scripts/mutation/vitest-runner.mjs';
import suite from '../../vitest.config.ts';
import mutation from '../../vitest.mutation.config.ts';

describe('forge-vitest mutation test runner', () => {
  it('widens covering test ids to one name-less id per test file, which selects every test of those files', () => {
    expect(fileFilter([
      'tests/documents/diff.unit.test.ts#unified dry-run diffs renders headers',
      'tests/documents/diff.unit.test.ts#unified dry-run diffs keeps # in names',
      'tests/backlog/ranks.unit.test.ts#rank arithmetic refuses a tie',
    ])).toEqual(['tests/documents/diff.unit.test.ts#', 'tests/backlog/ranks.unit.test.ts#']);
    expect(fileFilter([])).toEqual([]);
    // Without a filter (static mutants), the official runner keeps running the related test files.
    expect(fileFilter(undefined)).toBeUndefined();
  });

  it('creates the official vitest runner from Stryker\'s loaded plugins, delegates to it and rewrites only the mutant test filter', async () => {
    const calls: Array<[string, unknown]> = [];
    const official = {
      capabilities: () => ({ reloadEnvironment: true }),
      init: async () => { calls.push(['init', undefined]); },
      dryRun: async (options: unknown) => { calls.push(['dryRun', options]); return { status: 'complete', tests: [] }; },
      mutantRun: async (options: unknown) => { calls.push(['mutantRun', options]); return { status: 'survived' }; },
      dispose: async () => { calls.push(['dispose', undefined]); },
    };
    const [plugin] = strykerPlugins;
    expect(plugin).toMatchObject({ kind: 'TestRunner', name: 'forge-vitest' });
    expect(plugin!.factory.inject).toEqual(['$injector']);
    const factory = () => official;
    const injected: unknown[] = [];
    const plugins = new Map([['TestRunner', [{ kind: 'TestRunner', name: 'forge-vitest' }, { kind: 'TestRunner', name: 'vitest', factory }]]]);
    const injector = { resolve: () => plugins, injectFunction: (value: unknown) => { injected.push(value); return official; } };
    const runner = plugin!.factory(injector);
    expect(injected).toEqual([factory]);
    expect(() => plugin!.factory({ ...injector, resolve: () => new Map() })).toThrow('requires the @stryker-mutator/vitest-runner plugin');
    expect(runner.capabilities()).toEqual({ reloadEnvironment: true });
    await runner.init();
    await runner.dryRun({ coverageAnalysis: 'perTest' });
    await runner.mutantRun({ activeMutant: { id: '7' }, testFilter: ['tests/a.unit.test.ts#suite test'] });
    await runner.dispose();
    expect(calls).toEqual([
      ['init', undefined],
      ['dryRun', { coverageAnalysis: 'perTest' }],
      ['mutantRun', { activeMutant: { id: '7' }, testFilter: ['tests/a.unit.test.ts#'] }],
      ['dispose', undefined],
    ]);
  });

  it('runs mutants against exactly the unit project of the suite, with its include pattern and budgets', () => {
    const unit = suite.test?.projects?.find(project => typeof project === 'object' && 'test' in project && project.test?.name === 'unit');
    expect(unit).toMatchObject({ test: { name: 'unit', environment: 'node', testTimeout: 30_000, hookTimeout: 30_000 } });
    expect(mutation).toEqual({ test: (unit as { test: unknown }).test });
    expect(mutation.test?.include).toEqual(['tests/**/*.unit.test.{ts,mts,cts,tsx,js,mjs,cjs,jsx}']);
  });

  it('is the runner the mutation configuration loads, against the unit-only Vitest configuration', async () => {
    const config = JSON.parse(await readFile(resolve('stryker.config.json'), 'utf8'));
    expect(config).toMatchObject({
      testRunner: 'forge-vitest',
      plugins: expect.arrayContaining(['@stryker-mutator/vitest-runner', './scripts/mutation/vitest-runner.mjs']),
      vitest: { configFile: 'vitest.mutation.config.ts' },
      coverageAnalysis: 'perTest',
    });
  });
});
