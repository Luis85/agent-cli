import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { literalPattern, parseArgs, partition, planShards, selectFiles, shardOptions } from '../../scripts/mutation/shard.mjs';

const project = process.cwd();
const strykerConfig = () => JSON.parse(readFileSync('stryker.config.json', 'utf8')) as { mutate: string[], tempDirName: string, thresholds: Record<string, number | null> };

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

  it('balances the configured scope into deterministic, disjoint shards that together cover every selected file', () => {
    const config = strykerConfig();
    const selected = selectFiles(config.mutate, project);
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

  it.each([
    ['no patterns', { mutate: [] }, 'must list mutate patterns'],
    ['patterns that select nothing', { mutate: ['src/does-not-exist/**/*.ts'] }, 'select no file'],
  ])('refuses to plan with %s', (_, config, message) => {
    expect(() => planShards(config, 2, project)).toThrow(message);
  });
});

describe('mutate pattern expansion', () => {
  it('applies patterns in order like Stryker: a negated pattern removes the files selected before it', () => {
    const all = selectFiles(['src/plugins/backlog/domain/*.ts'], project);
    expect(all).toEqual(expect.arrayContaining(['src/plugins/backlog/domain/messages.ts', 'src/plugins/backlog/domain/writes.ts']));
    expect(all).toStrictEqual([...all].sort());
    const excluded = selectFiles(['src/plugins/backlog/domain/*.ts', '!**/messages.ts'], project);
    expect(excluded).toStrictEqual(all.filter(file => file !== 'src/plugins/backlog/domain/messages.ts'));
    // A later positive pattern selects the file again.
    expect(selectFiles(['src/plugins/backlog/domain/*.ts', '!**/messages.ts', 'src/plugins/backlog/domain/messages.ts'], project)).toStrictEqual(all);
    expect(selectFiles(['src/domain/documents/{diff,literal-edit}.ts'], project)).toStrictEqual(['src/domain/documents/diff.ts', 'src/domain/documents/literal-edit.ts']);
    expect(selectFiles(['src/domain/documents'], project)).toStrictEqual([]);
  });

  it('refuses line ranges, which cannot be split into whole-file shards', () => {
    expect(() => selectFiles(['src/domain/documents/diff.ts:10-20'], project)).toThrow('remove the line range');
    expect(() => selectFiles(['src/domain/documents/diff.ts:10:2-20:5'], project)).toThrow('remove the line range');
  });

  it('keeps every pattern of stryker.config.json effective, so a typo cannot silently shrink the scope', () => {
    const { mutate } = strykerConfig();
    const ineffective = mutate.filter((pattern, index) => {
      const before = selectFiles(mutate.slice(0, index), project);
      const after = selectFiles(mutate.slice(0, index + 1), project);
      // A positive pattern must select a file, a negated one must remove one.
      return pattern.startsWith('!') ? after.length === before.length : selectFiles([pattern], project).length === 0;
    });
    expect(ineffective).toStrictEqual([]);
  });

  it('uses a file path as its own mutate pattern and refuses paths with glob syntax, which Stryker would expand', () => {
    expect(literalPattern('src/plugins/backlog/domain/writes.ts')).toBe('src/plugins/backlog/domain/writes.ts');
    for (const file of ['src/[id].ts', 'src/page (copy).ts', 'src/{a,b}.ts', 'src/a*.ts', 'src/a?.ts', 'src/!a.ts', 'src/a+b.ts', 'src/@a.ts', 'src\\a.ts']) {
      expect(() => literalPattern(file), file).toThrow(`Cannot shard ${file}: its path contains glob syntax`);
    }
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
    const options = shardOptions(strykerConfig(), { configFile: 'stryker.config.json', dir: '.quality-reports/mutation', index: 2, files: ['src/a.ts', 'src/b.ts'], force: false });
    expect(options).toStrictEqual({
      configFile: 'stryker.config.json',
      mutate: ['src/a.ts', 'src/b.ts'],
      incrementalFile: '.quality-reports/mutation/shard-2/incremental.json',
      htmlReporter: { fileName: '.quality-reports/mutation/shard-2/index.html' },
      jsonReporter: { fileName: '.quality-reports/mutation/shard-2/mutation.json' },
      tempDirName: `${strykerConfig().tempDirName}-shard-2`,
      thresholds: { ...strykerConfig().thresholds, break: null },
    });
    expect(shardOptions({}, { configFile: 'c.json', dir: 'out', index: 1, files: ['a.ts'], force: true })).toMatchObject({ force: true, tempDirName: '.stryker-tmp-shard-1', thresholds: { break: null } });
  });
});
