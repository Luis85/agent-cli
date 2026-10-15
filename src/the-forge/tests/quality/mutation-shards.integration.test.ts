import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, promises, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
// Stryker's own expansion of `mutate`. The package exports only its API, so the module is imported by path, after the
// package entry, which initializes its circular imports in the right order.
import '@stryker-mutator/core';
import { ProjectReader } from '../../node_modules/@stryker-mutator/core/dist/src/fs/project-reader.js';
import { ignoreRules, literalPattern, matchFiles, planShards, projectFiles, selectFiles, writePlan } from '../../scripts/mutation/shard.mjs';

type StrykerConfig = { mutate: string[], tempDirName?: string, incrementalFile?: string, ignorePatterns?: string[], htmlReporter?: { fileName?: string }, jsonReporter?: { fileName?: string } };

const project = process.cwd();
const strykerConfig = () => JSON.parse(readFileSync('stryker.config.json', 'utf8')) as StrykerConfig;

const roots: string[] = [];
afterEach(() => {
  process.chdir(project);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A project directory holding the given files. */
function fixture(files: string[]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forge-mutation-shards-')));
  roots.push(root);
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), `// ${file}\n`);
  }
  return root;
}

/** The files Stryker itself would mutate in a project directory for a configuration, as sorted relative paths. */
async function strykerMutates(root: string, config: StrykerConfig) {
  const silent = () => undefined;
  const log = { trace: silent, debug: silent, info: silent, warn: silent, error: silent, fatal: silent, isTraceEnabled: () => false, isDebugEnabled: () => false, isInfoEnabled: () => false, isWarnEnabled: () => false, isErrorEnabled: () => false, isFatalEnabled: () => false };
  const options = { tempDirName: '.stryker-tmp', incrementalFile: 'reports/incremental.json', htmlReporter: { fileName: 'reports/index.html' }, jsonReporter: { fileName: 'reports/mutation.json' }, ignorePatterns: [], ...config, incremental: false, force: false };
  // Stryker reads the working directory.
  process.chdir(root);
  try {
    const { filesToMutate } = await new ProjectReader(promises as never, log as never, options as never).read(undefined);
    return [...filesToMutate.keys()].map(file => relative(root, file).replaceAll('\\', '/')).sort();
  } finally {
    process.chdir(project);
  }
}

describe('the configured mutation scope', () => {
  it('selects exactly the files Stryker mutates for stryker.config.json', async () => {
    const config = strykerConfig();
    const stryker = await strykerMutates(project, config);
    expect(selectFiles(config.mutate, project, ignoreRules(config))).toStrictEqual(stryker);
    expect(stryker.length).toBeGreaterThan(0);
  });

  it('balances the scope into deterministic, disjoint shards that together cover every selected file', () => {
    const config = strykerConfig();
    const selected = selectFiles(config.mutate, project, ignoreRules(config));
    const shards = planShards(config, 2, project);
    expect(planShards(config, 2, project)).toStrictEqual(shards);
    expect(shards.flat().sort()).toStrictEqual(selected);
    expect(new Set(shards.flat()).size).toBe(selected.length);
    expect(shards.flat().map(literalPattern)).toStrictEqual(shards.flat());
    const sizes = shards.map(files => files.reduce((total, file) => total + readFileSync(file).length, 0));
    const largest = Math.max(...selected.map(file => readFileSync(file).length));
    // Greedy balancing keeps the shards within one file of each other.
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(largest);
  });

  it('keeps every pattern of stryker.config.json effective, so a typo cannot silently shrink the scope', () => {
    const config = strykerConfig();
    const files = projectFiles(project, ignoreRules(config));
    const select = (patterns: string[]) => matchFiles(patterns, files, project);
    const ineffective = config.mutate.filter((pattern, index) => {
      const before = select(config.mutate.slice(0, index));
      const after = select(config.mutate.slice(0, index + 1));
      // A positive pattern must select a file, a negated one must remove one.
      return pattern.startsWith('!') ? after.length === before.length : select([pattern]).length === 0;
    });
    expect(ineffective).toStrictEqual([]);
  });

  it('refuses patterns that select nothing', () => {
    expect(() => planShards({ mutate: ['src/does-not-exist/**/*.ts'] }, 2, project)).toThrow('select no file');
  });
});

describe('reading the project like Stryker', () => {
  const files = ['src/a.ts', 'src/Upper.ts', 'src/.hidden.ts', 'src/.cache/a.ts', 'src/node_modules/b.ts', 'src/deep/messages.ts', 'node_modules/p/a.ts', '.git/a.ts',
    'out/a.ts', 'coverage/a.ts', 'coverage/keep.ts', 'Build/a.ts', 'src/notes.md'];

  it('never reads node_modules, .git, the configured outputs or ignorePatterns, which may re-include with !', () => {
    const root = fixture(files);
    expect(projectFiles(root, ['/out', 'coverage/*', '!coverage/keep.ts', 'build']).filter(file => !file.startsWith('src/')).sort()).toStrictEqual(['coverage/keep.ts']);
    expect(selectFiles(['**/*.ts'], root, ['/out', '/coverage', 'build'])).toStrictEqual(['src/Upper.ts', 'src/a.ts', 'src/deep/messages.ts']);
  });

  it.each([
    [['**/*.ts']],
    [['src/**', '!**/messages.ts']],
    [['src/upper.ts', 'src/.hidden.ts', 'src/.cache/*.ts', 'src']],
    [['**/a.ts', '!src/*.ts', 'src/{a,Upper}.ts']],
  ])('selects what Stryker selects for %j', async mutate => {
    const root = fixture(files);
    const config = { mutate, tempDirName: 'tmp', ignorePatterns: ['/out', 'coverage/*', '!coverage/keep.ts', 'build'] };
    expect(selectFiles(mutate, root, ignoreRules(config))).toStrictEqual(await strykerMutates(root, config));
  });
});

describe('the shard plan', () => {
  it('records a shard\'s files for the merge', () => {
    const root = fixture([]);
    writePlan(join(root, 'out'), 2, 3, ['src/a.ts', 'src/b.ts']);
    expect(JSON.parse(readFileSync(join(root, 'out/shard-2/plan.json'), 'utf8'))).toStrictEqual({ shard: 2, shards: 3, files: ['src/a.ts', 'src/b.ts'] });
  });
});
