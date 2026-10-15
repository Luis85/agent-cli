/**
 * Merges the reports of a sharded mutation run (scripts/mutation/shard.mjs) and judges the overall score. Run from
 * src/the-forge:
 *
 *   node scripts/mutation/merge.mjs --shards 2 [--config stryker.config.json] [--dir .quality-reports/mutation]
 *
 * Reads `<dir>/shard-<i>/mutation.json` for every shard, writes the merged mutation-testing-elements report to
 * `<dir>/mutation.json`, prints the per-file score table and, when GITHUB_STEP_SUMMARY is set, appends a Markdown
 * summary to the job summary. It exits 1 when the overall score, computed like Stryker's, is below the configuration's
 * `thresholds.break`, and fails on a missing, empty or unexpected shard report instead of passing on empty input.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatScore, mergeReports, mutantsOf, score, scoreTable, summaryMarkdown } from './report.mjs';

/**
 * Parses `--shards <n>`, `--config <file>` and `--dir <dir>`.
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{ shards?: number, config: string, dir: string }} */
  const options = { config: 'stryker.config.json', dir: '.quality-reports/mutation' };
  for (let position = 0; position < args.length; position++) {
    const arg = args[position];
    const value = args[++position];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    if (arg === '--shards') {
      if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error('--shards needs a positive integer');
      options.shards = Number(value);
    } else if (arg === '--config') options.config = value;
    else if (arg === '--dir') options.dir = value;
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (options.shards === undefined) throw new Error('Usage: node scripts/mutation/merge.mjs --shards <count> [--config <file>] [--dir <dir>]');
  return { ...options, shards: options.shards };
}

/**
 * Reads and validates the shard reports. `read(index)` returns a shard's mutation.json text or undefined when it is
 * missing; `present` lists the shard numbers found on disk, so a report from an unexpected shard fails as well.
 * @param {number} count @param {(index: number) => string | undefined} read @param {number[]} present
 * @returns {import('./report.mjs').Report[]}
 */
export function loadShardReports(count, read, present) {
  const unexpected = present.filter(index => index < 1 || index > count);
  if (unexpected.length > 0) throw new Error(`Found reports of shards ${unexpected.join(', ')}, but the run has ${count} shards`);
  return Array.from({ length: count }, (_, position) => {
    const index = position + 1;
    const text = read(index);
    if (text === undefined) throw new Error(`Shard ${index}/${count} wrote no mutation report`);
    /** @type {import('./report.mjs').Report} */
    let report;
    try {
      report = JSON.parse(text);
    } catch (error) {
      throw new Error(`Shard ${index}/${count} wrote an unreadable mutation report: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof report !== 'object' || report === null || typeof report.files !== 'object' || report.files === null) throw new Error(`Shard ${index}/${count} wrote a report without files`);
    if (mutantsOf(report).length === 0) throw new Error(`Shard ${index}/${count} reported no mutants`);
    return report;
  });
}

/**
 * Merges the shard reports and decides the outcome against `thresholds` from the Stryker configuration.
 * @param {import('./report.mjs').Report[]} reports
 * @param {{ high?: number, low?: number, break?: number | null } | undefined} thresholds
 */
export function judge(reports, thresholds) {
  const report = mergeReports(reports);
  report.thresholds = { high: thresholds?.high ?? 80, low: thresholds?.low ?? 60 };
  const total = score(mutantsOf(report));
  if (total.valid === 0) throw new Error('The merged report has no valid mutants to score');
  const breakAt = thresholds?.break;
  const passed = typeof breakAt !== 'number' || total.score >= breakAt;
  const verdict = typeof breakAt !== 'number'
    ? `Mutation score ${formatScore(total.score)}; no break threshold configured.`
    : passed
      ? `Mutation score ${formatScore(total.score)} is at or above the break threshold ${breakAt}.`
      : `Mutation score ${formatScore(total.score)} is below the break threshold ${breakAt}.`;
  return { report, total, passed, verdict, summary: summaryMarkdown(report, breakAt, reports.length) };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const dir = resolve(cwd, options.dir);
  const config = JSON.parse(readFileSync(resolve(cwd, options.config), 'utf8'));
  const present = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const match = /^shard-(\d+)$/.exec(entry.name);
    return entry.isDirectory() && match && existsSync(join(dir, entry.name, 'mutation.json')) ? [Number(match[1])] : [];
  }) : [];
  const reports = loadShardReports(options.shards, index => {
    const path = join(dir, `shard-${index}`, 'mutation.json');
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  }, present);
  const { report, passed, verdict, summary } = judge(reports, config.thresholds);
  writeFileSync(join(dir, 'mutation.json'), JSON.stringify(report));
  process.stdout.write(`${scoreTable(report)}\n\n${verdict}\nMerged report: ${join(options.dir, 'mutation.json')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (!passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
