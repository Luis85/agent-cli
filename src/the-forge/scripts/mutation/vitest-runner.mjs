/**
 * Stryker test runner `forge-vitest`: the official `vitest` runner with mutant test filters that Vitest 5 honors.
 *
 * @stryker-mutator/vitest-runner 10.0.0 identifies a test as `<file>#<suite and test names joined with spaces>` and
 * runs a mutant's covering tests through a `testNamePattern` built from those names. Vitest 5 matches the pattern
 * against `fullTestName`, which joins the names with " > ", so every mutant run selected no test and every mutant
 * survived without a single assertion. This wrapper looks the official runner up in Stryker's loaded plugins (the
 * `pluginsByKind` registry its plugin creator uses, so the configuration must also load
 * `@stryker-mutator/vitest-runner`), delegates everything to it and narrows each mutant run to whole test files instead:
 * it keeps the file of each covering test id and empties the name, which the official runner turns into a pattern
 * that matches every test of those files. Tests that do not cover the mutant run too, so results stay correct at file
 * rather than test granularity. Remove this file and use `testRunner: "vitest"` again once the official runner
 * supports Vitest 5 names; a report whose mutants all survive with `testsCompleted: 0` shows the mismatch.
 */

/**
 * Covering test ids reduced to one name-less id per test file.
 * @param {string[] | undefined} testFilter
 */
export function fileFilter(testFilter) {
  if (!testFilter) return undefined;
  return [...new Set(testFilter.map(id => `${id.split('#')[0]}#`))];
}

/**
 * @typedef {{ kind: string, name: string, factory?: unknown }} StrykerPlugin
 * @param {{ resolve: (token: 'pluginsByKind') => Map<string, StrykerPlugin[]>, injectFunction: (factory: unknown) => any }} injector
 */
function createForgeVitestRunner(injector) {
  const official = injector.resolve('pluginsByKind').get('TestRunner')?.find(plugin => plugin.name === 'vitest');
  if (!official?.factory) throw new Error('forge-vitest requires the @stryker-mutator/vitest-runner plugin to be loaded');
  const runner = injector.injectFunction(official.factory);
  return {
    capabilities: () => runner.capabilities(),
    init: () => runner.init(),
    dispose: () => runner.dispose(),
    /** @param {unknown} options */
    dryRun: options => runner.dryRun(options),
    /** @param {{ testFilter?: string[], [option: string]: unknown }} options */
    mutantRun: options => runner.mutantRun({ ...options, testFilter: fileFilter(options.testFilter) }),
  };
}
createForgeVitestRunner.inject = ['$injector'];

export const strykerPlugins = [{ kind: 'TestRunner', name: 'forge-vitest', factory: createForgeVitestRunner }];
