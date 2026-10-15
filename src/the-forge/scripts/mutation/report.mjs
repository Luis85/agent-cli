/**
 * Mutation-testing-elements reports (`mutation.json`, `incremental.json`) as written by Stryker: merging reports of
 * disjoint file sets and scoring them exactly like Stryker. Shared by the shard runner and the merge step.
 *
 * @typedef {{ id: string, name: string, location?: unknown, [key: string]: unknown }} TestDefinition
 * @typedef {{ source?: string, tests: TestDefinition[] }} TestFile
 * @typedef {{ id: string, status: string, coveredBy?: string[], killedBy?: string[], [key: string]: unknown }} MutantResult
 * @typedef {{ language?: string, source: string, mutants: MutantResult[] }} FileResult
 * @typedef {{ schemaVersion?: string, files: Record<string, FileResult>, testFiles?: Record<string, TestFile>, thresholds?: unknown, projectRoot?: string, framework?: unknown, [key: string]: unknown }} Report
 * @typedef {{ killed: number, timeout: number, survived: number, noCoverage: number, ignored: number, errors: number }} Counts
 * @typedef {Counts & { detected: number, valid: number, score: number }} Score
 */

/**
 * Stryker's mutation score: detected / (detected + undetected) in percent. Ignored, compile-error, runtime-error and
 * pending mutants are not valid and leave the denominator. A file set without valid mutants scores NaN.
 * @param {Iterable<MutantResult>} mutants
 * @returns {Score}
 */
export function score(mutants) {
  /** @type {Counts} */
  const counts = { killed: 0, timeout: 0, survived: 0, noCoverage: 0, ignored: 0, errors: 0 };
  for (const { status } of mutants) {
    if (status === 'Killed') counts.killed++;
    else if (status === 'Timeout') counts.timeout++;
    else if (status === 'Survived') counts.survived++;
    else if (status === 'NoCoverage') counts.noCoverage++;
    else if (status === 'Ignored') counts.ignored++;
    else counts.errors++;
  }
  const detected = counts.killed + counts.timeout;
  const valid = detected + counts.survived + counts.noCoverage;
  return { ...counts, detected, valid, score: valid === 0 ? Number.NaN : (detected / valid) * 100 };
}

/** @param {Report} report */
export function mutantsOf(report) {
  return Object.values(report.files).flatMap(file => file.mutants);
}

/**
 * Per-file scores, the files with the most surviving and uncovered mutants first, then by path.
 * @param {Report} report
 */
export function fileScores(report) {
  return Object.entries(report.files)
    .map(([path, file]) => ({ path, ...score(file.mutants) }))
    .sort((a, b) => (b.survived + b.noCoverage) - (a.survived + a.noCoverage) || a.path.localeCompare(b.path));
}

/**
 * Merges reports into one. Each mutated file must come from exactly one report unless `prefer` picks among duplicates
 * (used when seeding an incremental file from several earlier runs). Test files are united and every test is
 * identified by file and name, so the merged ids and each mutant's `coveredBy`/`killedBy` stay consistent. Mutant ids
 * are prefixed with the report's position because every Stryker run numbers its mutants from 0. `allTests: false` keeps
 * only the tests that a kept mutant references.
 * @param {Report[]} reports
 * @param {{ keepFile?: (path: string) => boolean, prefer?: (path: string, candidates: FileResult[]) => FileResult, allTests?: boolean }} [options]
 * @returns {Report}
 */
export function mergeReports(reports, { keepFile = () => true, prefer, allTests = true } = {}) {
  /** @type {Map<string, Array<{ file: FileResult, index: number }>>} */
  const candidates = new Map();
  reports.forEach((report, index) => {
    for (const [path, file] of Object.entries(report.files ?? {})) {
      if (!keepFile(path)) continue;
      candidates.set(path, [...(candidates.get(path) ?? []), { file, index }]);
    }
  });
  const tests = new TestIndex();
  /** @type {Record<string, FileResult>} */
  const files = {};
  for (const path of [...candidates.keys()].sort()) {
    const entries = /** @type {Array<{ file: FileResult, index: number }>} */ (candidates.get(path));
    if (entries.length > 1 && !prefer) throw new Error(`${path} appears in more than one report; shards must mutate disjoint files`);
    const chosen = entries.length > 1 && prefer ? prefer(path, entries.map(entry => entry.file)) : entries[0]?.file;
    const { file, index } = /** @type {{ file: FileResult, index: number }} */ (entries.find(entry => entry.file === chosen));
    const report = /** @type {Report} */ (reports[index]);
    files[path] = {
      ...file,
      mutants: file.mutants.map(mutant => ({
        ...mutant,
        id: `${index + 1}.${mutant.id}`,
        ...(mutant.coveredBy ? { coveredBy: tests.ids(report, index, mutant.coveredBy) } : {}),
        ...(mutant.killedBy ? { killedBy: tests.ids(report, index, mutant.killedBy) } : {}),
      })),
    };
  }
  if (allTests) reports.forEach((report, index) => tests.ids(report, index, Object.values(report.testFiles ?? {}).flatMap(file => file.tests.map(test => test.id))));
  const [first] = reports;
  return {
    schemaVersion: first?.schemaVersion ?? '1.0',
    thresholds: first?.thresholds,
    ...(first?.projectRoot ? { projectRoot: first.projectRoot } : {}),
    ...(first?.framework ? { framework: first.framework } : {}),
    files,
    testFiles: tests.testFiles(),
  };
}

/** Tests referenced by kept mutants, merged by file and name across reports. */
class TestIndex {
  /** @type {Map<string, { source?: string, tests: Map<string, TestDefinition> }>} */
  #files = new Map();
  /** @type {Map<number, Map<string, { file: string, test: TestDefinition, source?: string }>>} */
  #byReport = new Map();
  #next = 0;

  /**
   * Merged ids of a report's test ids; ids the report does not define are dropped, as Stryker does.
   * @param {Report} report @param {number} index @param {string[]} ids
   */
  ids(report, index, ids) {
    const lookup = this.#lookup(report, index);
    return ids.flatMap(id => {
      const entry = lookup.get(id);
      return entry ? [this.#add(entry.file, entry.test, entry.source)] : [];
    });
  }

  testFiles() {
    /** @type {Record<string, TestFile>} */
    const result = {};
    for (const path of [...this.#files.keys()].sort()) {
      const { source, tests } = /** @type {{ source?: string, tests: Map<string, TestDefinition> }} */ (this.#files.get(path));
      result[path] = { ...(source === undefined ? {} : { source }), tests: [...tests.values()] };
    }
    return result;
  }

  /** @param {Report} report @param {number} index */
  #lookup(report, index) {
    let lookup = this.#byReport.get(index);
    if (!lookup) {
      lookup = new Map();
      for (const [file, testFile] of Object.entries(report.testFiles ?? {})) {
        for (const test of testFile.tests) lookup.set(test.id, { file, test, source: testFile.source });
      }
      this.#byReport.set(index, lookup);
    }
    return lookup;
  }

  /** @param {string} file @param {TestDefinition} test @param {string | undefined} source */
  #add(file, test, source) {
    let entry = this.#files.get(file);
    if (!entry) {
      entry = { source, tests: new Map() };
      this.#files.set(file, entry);
    }
    const existing = entry.tests.get(test.name);
    if (existing) return existing.id;
    // A location only means something against the source it was recorded in.
    const merged = { ...test, id: String(this.#next++) };
    if (entry.source !== source) delete merged.location;
    entry.tests.set(test.name, merged);
    return merged.id;
  }
}

/** @param {number} value */
export function formatScore(value) {
  return Number.isNaN(value) ? 'n/a' : `${value.toFixed(2)}%`;
}

/**
 * The per-file score table printed to the terminal.
 * @param {Report} report
 */
export function scoreTable(report) {
  const rows = fileScores(report).map(file => [file.path, formatScore(file.score), file.killed, file.timeout, file.survived, file.noCoverage]);
  const total = score(mutantsOf(report));
  rows.push(['All files', formatScore(total.score), total.killed, total.timeout, total.survived, total.noCoverage]);
  const header = ['File', 'Score', 'Killed', 'Timeout', 'Survived', 'No coverage'];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map(row => String(row[column]).length)));
  /** @param {Array<string | number>} cells */
  const line = cells => cells.map((cell, column) => column === 0 ? String(cell).padEnd(widths[0] ?? 0) : String(cell).padStart(widths[column] ?? 0)).join('  ');
  return [line(header), ...rows.map(line)].join('\n');
}

/**
 * A Markdown job summary: the overall score against the break threshold and every file with gaps.
 * @param {Report} report @param {number | null | undefined} breakAt @param {number} shards
 */
export function summaryMarkdown(report, breakAt, shards) {
  const total = score(mutantsOf(report));
  const verdict = typeof breakAt === 'number' ? (total.score >= breakAt ? `at or above the break threshold ${breakAt}` : `**below the break threshold ${breakAt}**`) : 'no break threshold configured';
  const files = fileScores(report);
  const gaps = files.filter(file => file.survived + file.noCoverage > 0);
  return [
    '## Mutation score',
    '',
    `**${formatScore(total.score)}** over ${files.length} files from ${shards} shards, ${verdict}: ${total.killed} killed, ${total.timeout} timed out, ${total.survived} survived, ${total.noCoverage} without coverage, ${total.ignored} ignored.`,
    '',
    ...(gaps.length === 0 ? ['Every mutant was detected.'] : [
      '| File | Score | Survived | No coverage |',
      '| --- | ---: | ---: | ---: |',
      ...gaps.map(file => `| \`${file.path}\` | ${formatScore(file.score)} | ${file.survived} | ${file.noCoverage} |`),
    ]),
    '',
  ].join('\n');
}
