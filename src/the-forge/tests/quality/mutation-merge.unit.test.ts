import { describe, expect, it } from 'vitest';
import { checkPlans, judge, loadShardPlans, loadShardReports, parseArgs } from '../../scripts/mutation/merge.mjs';
import { fileScores, mergeReports, score, scoreTable, summaryMarkdown } from '../../scripts/mutation/report.mjs';
import type { MutantResult, Report } from '../../scripts/mutation/report.mjs';

const mutants = (...statuses: string[]): MutantResult[] => statuses.map((status, index) => ({ id: String(index), status }));

/** A shard report: each file gets the given statuses; mutant 0 of each file is covered by test 0 and killed by test 1. */
function shardReport(files: Record<string, string[]>, testSource = 'test source'): Report {
  return {
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60 },
    projectRoot: '/project',
    files: Object.fromEntries(Object.entries(files).map(([path, statuses]) => [path, {
      language: 'typescript',
      source: `source of ${path}`,
      mutants: mutants(...statuses).map((mutant, index) => index === 0 ? { ...mutant, coveredBy: ['0', '1'], killedBy: ['1'] } : mutant),
    }])),
    testFiles: {
      'tests/a.unit.test.ts': { source: testSource, tests: [{ id: '0', name: 'reads', location: { start: { line: 1, column: 1 } } }, { id: '1', name: 'writes' }] },
    },
  };
}

describe('mutation score', () => {
  it.each([
    [['Killed', 'Killed', 'Timeout', 'Survived'], 75],
    [['Killed', 'NoCoverage'], 50],
    [['Killed', 'Ignored', 'CompileError', 'RuntimeError', 'Pending'], 100],
    [['Survived'], 0],
  ])('scores %j as %s like Stryker: (killed + timeout) / (killed + timeout + survived + no coverage)', (statuses, expected) => {
    expect(score(mutants(...statuses)).score).toBe(expected);
  });

  it('counts every status and has no score without valid mutants', () => {
    expect(score(mutants('Killed', 'Timeout', 'Survived', 'NoCoverage', 'Ignored', 'CompileError', 'RuntimeError'))).toStrictEqual({
      killed: 1, timeout: 1, survived: 1, noCoverage: 1, ignored: 1, errors: 2, detected: 2, valid: 4, score: 50,
    });
    expect(score(mutants('Ignored', 'CompileError')).score).toBeNaN();
  });

  it('orders files by surviving and uncovered mutants, then by path', () => {
    const report = shardReport({ 'b.ts': ['Killed', 'Survived'], 'a.ts': ['Killed', 'NoCoverage'], 'c.ts': ['Survived', 'Survived', 'NoCoverage'], 'd.ts': ['Killed'] });
    expect(fileScores(report).map(file => [file.path, file.score])).toStrictEqual([['c.ts', 0], ['a.ts', 50], ['b.ts', 50], ['d.ts', 100]]);
  });

  it('orders paths by code unit, whatever the locale', () => {
    const report = shardReport({ 'b.ts': ['Killed'], 'a.ts': ['Killed'], 'B.ts': ['Killed'], 'ä.ts': ['Killed'], 'z.ts': ['Killed'] });
    expect(fileScores(report).map(file => file.path)).toStrictEqual(['B.ts', 'a.ts', 'b.ts', 'z.ts', 'ä.ts']);
  });
});

describe('merging shard reports', () => {
  it('unites disjoint files, renumbers mutants and keeps each mutant pointing at the same tests by name', () => {
    const merged = mergeReports([shardReport({ 'b.ts': ['Killed', 'Survived'] }), shardReport({ 'a.ts': ['Timeout'] })]);
    expect(Object.keys(merged.files)).toStrictEqual(['a.ts', 'b.ts']);
    expect(merged.files['b.ts']!.mutants.map(mutant => mutant.id)).toStrictEqual(['1.0', '1.1']);
    expect(merged.files['a.ts']!.mutants.map(mutant => mutant.id)).toStrictEqual(['2.0']);
    const names = (ids: string[] | undefined) => ids?.map(id => merged.testFiles!['tests/a.unit.test.ts']!.tests.find(test => test.id === id)?.name);
    for (const path of ['a.ts', 'b.ts']) {
      expect(names(merged.files[path]!.mutants[0]!.coveredBy)).toStrictEqual(['reads', 'writes']);
      expect(names(merged.files[path]!.mutants[0]!.killedBy)).toStrictEqual(['writes']);
    }
    // The same test in both shards appears once.
    expect(merged.testFiles).toStrictEqual({
      'tests/a.unit.test.ts': { source: 'test source', tests: [{ id: '0', name: 'reads', location: { start: { line: 1, column: 1 } } }, { id: '1', name: 'writes' }] },
    });
    expect(merged).toMatchObject({ schemaVersion: '1.0', projectRoot: '/project' });
    expect(merged.files['b.ts']!.mutants[1]).toStrictEqual({ id: '1.1', status: 'Survived' });
  });

  it('refuses a file that two shards mutated', () => {
    expect(() => mergeReports([shardReport({ 'a.ts': ['Killed'] }), shardReport({ 'a.ts': ['Survived'] })])).toThrow('a.ts appears in more than one report');
  });

  it('can keep only some files, choose among duplicates and drop tests no kept mutant references', () => {
    const report = shardReport({ 'a.ts': ['Killed'], 'b.ts': ['Survived'] });
    const other = shardReport({ 'a.ts': ['Survived'] }, 'changed test source');
    other.testFiles!['tests/b.unit.test.ts'] = { tests: [{ id: '7', name: 'unrelated' }] };
    const seeded = mergeReports([report, other], { keepFile: path => path === 'a.ts', prefer: (_, candidates) => candidates[1]!, allTests: false });
    expect(Object.keys(seeded.files)).toStrictEqual(['a.ts']);
    expect(seeded.files['a.ts']!.mutants[0]).toMatchObject({ id: '2.0', status: 'Survived' });
    expect(seeded.testFiles).toStrictEqual({
      'tests/a.unit.test.ts': { source: 'changed test source', tests: [{ id: '0', name: 'reads', location: { start: { line: 1, column: 1 } } }, { id: '1', name: 'writes' }] },
    });
  });

  it('drops references to a test file recorded against other source, so Stryker retests instead of reusing a stale kill', () => {
    // Report 1 records the test file as it is now; report 2 recorded `writes` killing a mutant of b.ts in an older version.
    const fresh = shardReport({ 'a.ts': ['Killed'] }, 'new test source');
    const stale = shardReport({ 'b.ts': ['Killed', 'Survived'] }, 'old test source');
    stale.files['b.ts']!.mutants[1] = { id: '1', status: 'Survived', coveredBy: ['0', '7'] };
    stale.testFiles!['tests/c.unit.test.ts'] = { source: 'c', tests: [{ id: '7', name: 'covers', location: { start: { line: 3, column: 1 } } }] };
    for (const allTests of [true, false]) {
      const merged = mergeReports([fresh, stale], { prefer: (_, candidates) => candidates[0]!, allTests });
      expect(merged.files['a.ts']!.mutants[0]).toStrictEqual({ id: '1.0', status: 'Killed', coveredBy: ['0', '1'], killedBy: ['1'] });
      // Without a killing test Stryker cannot reuse the kill; without the covering test the survivor gains an added test.
      expect(merged.files['b.ts']!.mutants).toStrictEqual([
        { id: '2.0', status: 'Killed', coveredBy: [], killedBy: [] },
        { id: '2.1', status: 'Survived', coveredBy: ['2'] },
      ]);
      // Every merged test belongs to the source it is listed with.
      expect(merged.testFiles).toStrictEqual({
        'tests/a.unit.test.ts': { source: 'new test source', tests: [{ id: '0', name: 'reads', location: { start: { line: 1, column: 1 } } }, { id: '1', name: 'writes' }] },
        'tests/c.unit.test.ts': { source: 'c', tests: [{ id: '2', name: 'covers', location: { start: { line: 3, column: 1 } } }] },
      });
    }
  });

  it('takes a test file\'s source from the first report that contributes a file, whatever the file order', () => {
    const first = shardReport({ 'z.ts': ['Killed'] }, 'first test source');
    const second = shardReport({ 'a.ts': ['Killed'] }, 'second test source');
    const merged = mergeReports([first, second, shardReport({}, 'unused test source')], { allTests: false });
    expect(merged.testFiles!['tests/a.unit.test.ts']!.source).toBe('first test source');
    expect(merged.files['z.ts']!.mutants[0]).toMatchObject({ killedBy: ['1'] });
    expect(merged.files['a.ts']!.mutants[0]).toMatchObject({ coveredBy: [], killedBy: [] });
    // A report that contributes no file does not decide the source.
    const seeded = mergeReports([shardReport({}, 'unused test source'), second], { allTests: false });
    expect(seeded.testFiles!['tests/a.unit.test.ts']!.source).toBe('second test source');
  });
});

describe('judging the merged score', () => {
  const reports = () => [shardReport({ 'a.ts': ['Killed', 'Killed', 'Killed', 'Survived'] }), shardReport({ 'b.ts': ['Killed', 'NoCoverage', 'Ignored'] })];

  it.each([
    [{ high: 80, low: 60, break: 66 }, true, 'Mutation score 66.67% is at or above the break threshold 66.'],
    [{ high: 80, low: 60, break: 67 }, false, 'Mutation score 66.67% is below the break threshold 67.'],
    [{ high: 80, low: 60, break: null }, true, 'Mutation score 66.67%; no break threshold configured.'],
    [undefined, true, 'Mutation score 66.67%; no break threshold configured.'],
  ])('applies thresholds %j to the overall score', (thresholds, passed, verdict) => {
    const result = judge(reports(), thresholds);
    expect(result).toMatchObject({ passed, verdict, total: { detected: 4, valid: 6 } });
    expect(result.report.thresholds).toStrictEqual({ high: 80, low: 60 });
  });

  it('refuses a merged report without valid mutants', () => {
    expect(() => judge([shardReport({ 'a.ts': ['Ignored'] })], { break: 50 })).toThrow('no valid mutants');
  });

  it('summarizes the overall score and the files with gaps for the job summary', () => {
    const { summary } = judge(reports(), { break: 67 });
    expect(summary).toBe([
      '## Mutation score',
      '',
      '**66.67%** over 2 files from 2 shards, **below the break threshold 67**: 4 killed, 0 timed out, 1 survived, 1 without coverage, 1 ignored.',
      '',
      '| File | Score | Survived | No coverage |',
      '| --- | ---: | ---: | ---: |',
      '| `a.ts` | 75.00% | 1 | 0 |',
      '| `b.ts` | 50.00% | 0 | 1 |',
      '',
    ].join('\n'));
    expect(summaryMarkdown(shardReport({ 'a.ts': ['Killed'] }), 50, 1)).toContain('at or above the break threshold 50: 1 killed');
    expect(summaryMarkdown(shardReport({ 'a.ts': ['Killed'] }), null, 1)).toContain('no break threshold configured');
    expect(summaryMarkdown(shardReport({ 'a.ts': ['Killed'] }), 50, 1)).toContain('Every mutant was detected.');
  });

  it('prints an aligned per-file table with a total row', () => {
    expect(scoreTable(judge(reports(), { break: 50 }).report).split('\n')).toStrictEqual([
      'File        Score  Killed  Timeout  Survived  No coverage',
      'a.ts       75.00%       3        0         1            0',
      'b.ts       50.00%       1        0         0            1',
      'All files  66.67%       4        0         1            1',
    ]);
  });
});

describe('reading shard reports', () => {
  const valid = () => JSON.stringify(shardReport({ 'a.ts': ['Killed'] }));

  it('returns every shard report in shard order', () => {
    const texts = [JSON.stringify(shardReport({ 'a.ts': ['Killed'] })), JSON.stringify(shardReport({ 'b.ts': ['Survived'] }))];
    expect(loadShardReports(2, index => texts[index - 1], [2, 1]).map(report => Object.keys(report.files))).toStrictEqual([['a.ts'], ['b.ts']]);
  });

  it.each([
    ['a missing shard', 2, (index: number) => index === 1 ? valid() : undefined, [1], 'Shard 2/2 wrote no mutation report'],
    ['an unreadable report', 1, () => '{', [1], 'Shard 1/1 wrote an unreadable mutation report'],
    ['a report without files', 1, () => '{"schemaVersion":"1.0"}', [1], 'Shard 1/1 wrote a report without files'],
    ['a null report', 1, () => 'null', [1], 'Shard 1/1 wrote a report without files'],
    ['a report without mutants', 1, () => JSON.stringify(shardReport({ 'a.ts': [] })), [1], 'Shard 1/1 reported no mutants'],
    ['more shards on disk than expected', 2, () => valid(), [1, 2, 3], 'Found reports of shards 3, but the run has 2 shards'],
  ])('fails loudly on %s', (_, count, read, present, message) => {
    expect(() => loadShardReports(count, read, present)).toThrow(message);
  });

  it('reads every shard\'s plan in shard order', () => {
    const texts = [JSON.stringify({ shard: 1, shards: 2, files: ['a.ts'] }), JSON.stringify({ shard: 2, shards: 2, files: ['b.ts', 'c.ts'] })];
    expect(loadShardPlans(2, index => texts[index - 1])).toStrictEqual([['a.ts'], ['b.ts', 'c.ts']]);
  });

  it.each([
    ['a missing plan', 2, (index: number) => index === 1 ? '{"shard":1,"shards":2,"files":["a.ts"]}' : undefined, 'Shard 2/2 wrote no plan'],
    ['an unreadable plan', 1, () => '{', 'Shard 1/1 wrote an unreadable plan'],
    ['a plan of another shard', 2, (index: number) => `{"shard":1,"shards":2,"files":["${index}.ts"]}`, 'Shard 2/2 wrote the plan of shard 1/2'],
    ['a plan of another partition', 2, (index: number) => `{"shard":${index},"shards":3,"files":["a.ts"]}`, 'Shard 1/2 wrote the plan of shard 1/3'],
    ['a plan without files', 1, () => '{"shard":1,"shards":1}', 'Shard 1/1 wrote a plan without a file list'],
    ['a plan with an empty file list', 1, () => '{"shard":1,"shards":1,"files":[]}', 'Shard 1/1 wrote a plan without a file list'],
    ['a plan listing a non-path', 1, () => '{"shard":1,"shards":1,"files":["a.ts",3]}', 'Shard 1/1 wrote a plan without a file list'],
    ['a null plan', 1, () => 'null', 'Shard 1/1 wrote an unreadable plan'],
  ])('fails loudly on %s', (_, count, read, message) => {
    expect(() => loadShardPlans(count, read)).toThrow(message);
  });

  it('accepts reports that cover exactly their disjoint plans', () => {
    expect(() => checkPlans([['a.ts', 'b.ts'], ['c.ts']], [shardReport({ 'b.ts': ['Killed'], 'a.ts': ['Survived'] }), shardReport({ 'c.ts': ['Killed'] })])).not.toThrow();
  });

  it.each([
    // Stryker only warns when a mutate pattern matches no file, and a file without mutants leaves no trace either.
    ['planned files the report lacks', [['a.ts', 'b.ts', 'd.ts', 'e.ts'], ['c.ts']], 'Shard 1/2 reported no mutants for d.ts, e.ts, which it planned: Stryker matched no file or found nothing to mutate'],
    ['a reported file the shard did not plan', [['a.ts'], ['c.ts']], 'Shard 1/2 reported b.ts, which it did not plan'],
    ['plans that overlap', [['a.ts', 'b.ts'], ['b.ts', 'c.ts']], 'b.ts is planned for shards 1 and 2'],
  ])('refuses %s', (_, plans, message) => {
    expect(() => checkPlans(plans, [shardReport({ 'b.ts': ['Killed'], 'a.ts': ['Survived'] }), shardReport({ 'c.ts': ['Killed'] })])).toThrow(message);
  });

  it.each([
    [['--shards', '2'], { shards: 2, config: 'stryker.config.json', dir: '.quality-reports/mutation' }],
    [['--shards', '3', '--config', 'c.json', '--dir', 'out'], { shards: 3, config: 'c.json', dir: 'out' }],
  ])('parses %j', (args, expected) => {
    expect(parseArgs(args)).toStrictEqual(expected);
  });

  it.each([
    [[], 'Usage'],
    [['--shards', '0'], '--shards needs a positive integer'],
    [['--shards', 'two'], '--shards needs a positive integer'],
    [['--shards'], '--shards needs a value'],
    [['--shards', '2', '--force', 'x'], 'Unknown argument --force'],
  ])('rejects %j', (args, message) => {
    expect(() => parseArgs(args)).toThrow(message);
  });
});
