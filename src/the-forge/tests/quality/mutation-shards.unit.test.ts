import { describe, expect, it } from 'vitest';
import { ignoreRules, literalPattern, matchFiles, parseArgs, partition, planShards, shardOptions } from '../../scripts/mutation/shard.mjs';

describe('mutation shard partitioning', () => {
  it('assigns every file to exactly one shard, largest first to the lightest shard, ties by path and lowest shard', () => {
    const files = [
      { path: 'c.ts', size: 50 }, { path: 'a.ts', size: 100 }, { path: 'b.ts', size: 100 },
      { path: 'd.ts', size: 30 }, { path: 'e.ts', size: 20 }, { path: 'f.ts', size: 20 },
    ];
    // a→1 (100), b→2 (100), c→1 (150), d→2 (130), e→2 (150), f→1 (170): a tie goes to the lower shard.
    expect(partition(files, 2)).toStrictEqual([['a.ts', 'c.ts', 'f.ts'], ['b.ts', 'd.ts', 'e.ts']]);
    expect(partition([...files].reverse(), 2)).toStrictEqual(partition(files, 2));
    expect(partition(files, 1)).toStrictEqual([['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts']]);
    expect(partition(files.slice(0, 2), 3)).toStrictEqual([['a.ts'], ['c.ts'], []]);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects the shard count %s', count => {
    expect(() => partition([{ path: 'a.ts', size: 1 }], count)).toThrow('The shard count must be a positive integer');
  });

  it('refuses to plan without mutate patterns', () => {
    expect(() => planShards({ mutate: [] }, 2, '/nowhere')).toThrow('must list mutate patterns');
    expect(() => planShards({}, 2, '/nowhere')).toThrow('must list mutate patterns');
  });

  it('uses a file path as its own mutate pattern and refuses paths with glob syntax, which Stryker would expand', () => {
    expect(literalPattern('src/plugins/backlog/domain/writes.ts')).toBe('src/plugins/backlog/domain/writes.ts');
    for (const file of ['src/[id].ts', 'src/page (copy).ts', 'src/{a,b}.ts', 'src/a*.ts', 'src/a?.ts', 'src/!a.ts', 'src/a+b.ts', 'src/@a.ts', 'src\\a.ts']) {
      expect(() => literalPattern(file), file).toThrow(`Cannot shard ${file}: its path contains glob syntax`);
    }
  });

  it('ignores what Stryker ignores for a configuration: its sandbox, incremental file, reports and ignorePatterns', () => {
    expect(ignoreRules({
      tempDirName: '.tmp', incrementalFile: 'out/incremental.json', htmlReporter: { fileName: 'out/index.html' },
      jsonReporter: { fileName: 'out/mutation.json' }, ignorePatterns: ['/coverage', '!/coverage/keep'],
    })).toStrictEqual(['.tmp', 'out/incremental.json', 'out/index.html', 'out/mutation.json', '/coverage', '!/coverage/keep']);
    expect(ignoreRules({ htmlReporter: {}, jsonReporter: {} })).toStrictEqual([]);
    expect(ignoreRules({})).toStrictEqual([]);
  });
});

describe('mutate pattern matching', () => {
  const files = () => ['src/a.ts', 'src/b.ts', 'src/messages.ts', 'src/deep/c.ts', 'src/notes.md', 'src/Upper.ts', 'src/.hidden.ts', 'src/.cache/d.ts'];

  it.each([
    [['src/*.ts'], ['src/Upper.ts', 'src/a.ts', 'src/b.ts', 'src/messages.ts']],
    // A negated pattern removes the files selected before it; a later positive pattern selects them again.
    [['src/*.ts', '!**/messages.ts'], ['src/Upper.ts', 'src/a.ts', 'src/b.ts']],
    [['!**/messages.ts', 'src/messages.ts'], ['src/messages.ts']],
    [['src/*.ts', '!**/messages.ts', 'src/messages.ts'], ['src/Upper.ts', 'src/a.ts', 'src/b.ts', 'src/messages.ts']],
    [['src/{a,messages}.ts', 'src/**/c.ts'], ['src/a.ts', 'src/deep/c.ts', 'src/messages.ts']],
    [['./src/deep/../a.ts'], ['src/a.ts']],
    // Matching is case-sensitive on every platform, and wildcards skip dot files that a literal name selects.
    [['src/upper.ts'], []],
    [['src/**/*.ts', '!src/upper.ts', '!src/deep/**'], ['src/Upper.ts', 'src/a.ts', 'src/b.ts', 'src/messages.ts']],
    [['src/.hidden.ts', 'src/.cache/*.ts'], ['src/.cache/d.ts', 'src/.hidden.ts']],
    // Only files are selected.
    [['src', 'src/deep'], []],
  ])('selects for %j: %j', (patterns, expected) => {
    expect(matchFiles(patterns, files(), '/project')).toStrictEqual(expected);
  });

  it.each(['src/a.ts:10-20', 'src/a.ts:10:2-20:5', '!src/a.ts:1-2'])('refuses the line range in %s, which cannot be split into whole-file shards', pattern => {
    expect(() => matchFiles([pattern], files(), '/project')).toThrow(`remove the line range from mutate pattern "${pattern}"`);
  });
});

describe('shard command line and Stryker options', () => {
  it.each([
    [['--shard', '1/2'], { shard: { index: 1, count: 2 }, force: false, config: 'stryker.config.json', dir: '.quality-reports/mutation' }],
    [['--shard', '2/2', '--force', '--config', 'x.json', '--dir', 'out'], { shard: { index: 2, count: 2 }, force: true, config: 'x.json', dir: 'out' }],
    [['--list', '3'], { list: 3, force: false, config: 'stryker.config.json', dir: '.quality-reports/mutation' }],
  ])('parses %j', (args, expected) => {
    expect(parseArgs(args)).toStrictEqual(expected);
  });

  it.each([
    [[], 'Usage'],
    [['--shard', '1/2', '--list', '2'], 'Usage'],
    [['--shard', '3/2'], '--shard must be'],
    [['--shard', '0/2'], '--shard must be'],
    [['--shard', '1'], '--shard must be'],
    [['--shard'], '--shard needs a value'],
    [['--shard', '--force'], '--shard needs a value'],
    [['--list', '0'], '--list needs a positive integer'],
    [['--shard', '1/2', '--parallel'], 'Unknown argument --parallel'],
  ])('rejects %j', (args, message) => {
    expect(() => parseArgs(args)).toThrow(message);
  });

  it('runs a shard on its own files with separate reports, incremental file and sandbox, and without the break threshold', () => {
    const config = { tempDirName: '.quality-reports/stryker-tmp', thresholds: { high: 80, low: 70, break: 78 } };
    expect(shardOptions(config, { configFile: 'stryker.config.json', dir: '.quality-reports/mutation', index: 2, files: ['src/a.ts', 'src/b.ts'], force: false })).toStrictEqual({
      configFile: 'stryker.config.json',
      mutate: ['src/a.ts', 'src/b.ts'],
      incrementalFile: '.quality-reports/mutation/shard-2/incremental.json',
      htmlReporter: { fileName: '.quality-reports/mutation/shard-2/index.html' },
      jsonReporter: { fileName: '.quality-reports/mutation/shard-2/mutation.json' },
      tempDirName: '.quality-reports/stryker-tmp-shard-2',
      thresholds: { high: 80, low: 70, break: null },
    });
    expect(shardOptions({}, { configFile: 'c.json', dir: 'out', index: 1, files: ['a.ts'], force: true })).toMatchObject({ force: true, tempDirName: '.stryker-tmp-shard-1', thresholds: { break: null } });
  });
});
