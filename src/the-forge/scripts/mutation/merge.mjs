/**
 * Merges the reports of a sharded mutation run (scripts/mutation/shard.mjs) and judges the overall score. Run from
 * src/the-forge:
 *
 *   node scripts/mutation/merge.mjs --shards 2 [--config stryker.config.json] [--dir .quality-reports/mutation]
 *
 * Reads `<dir>/shard-<i>/mutation.json` and the shard's `plan.json` for every shard, writes the merged
 * mutation-testing-elements report to `<dir>/mutation.json`, prints the per-file score table and, when
 * GITHUB_STEP_SUMMARY is set, appends a Markdown summary to the job summary. It exits 1 when the overall score, computed
 * like Stryker's, is below the configuration's `thresholds.break`, and fails on a missing, empty or unexpected shard
 * report, a missing plan, overlapping plans or a report whose files differ from its plan instead of passing on
 * incomplete input. The merge job installs no packages, so this script and report.mjs import only Node built-ins.
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
 * Reads the plans that scripts/mutation/shard.mjs wrote: the files each shard was to mutate. `read(index)` returns a
 * shard's plan.json text or undefined when it is missing.
 * @param {number} count @param {(index: number) => string | undefined} read
 * @returns {string[][]}
 */
export function loadShardPlans(count, read) {
  return Array.from({ length: count }, (_, position) => {
    const index = position + 1;
    const text = read(index);
    if (text === undefined) throw new Error(`Shard ${index}/${count} wrote no plan`);
    /** @type {{ shard?: unknown, shards?: unknown, files?: unknown }} */
    let plan;
    try {
      plan = JSON.parse(text);
    } catch (error) {
      throw new Error(`Shard ${index}/${count} wrote an unreadable plan: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof plan !== 'object' || plan === null) throw new Error(`Shard ${index}/${count} wrote an unreadable plan: not an object`);
    if (plan.shard !== index || plan.shards !== count) throw new Error(`Shard ${index}/${count} wrote the plan of shard ${String(plan.shard)}/${String(plan.shards)}`);
    const { files } = plan;
    if (!Array.isArray(files) || files.length === 0 || !files.every(file => typeof file === 'string')) throw new Error(`Shard ${index}/${count} wrote a plan without a file list`);
    return /** @type {string[]} */ (files);
  });
}

/**
 * Requires disjoint plans and every shard report to hold exactly its planned files. Stryker only warns when a mutate
 * pattern matches no file, so a planned file missing from the report would otherwise drop out of the score unnoticed.
 * @param {string[][]} plans @param {import('./report.mjs').Report[]} reports
 */
export function checkPlans(plans, reports) {
  /** @type {Map<string, number>} */
  const owners = new Map();
  plans.forEach((files, position) => {
    for (const file of files) {
      const owner = owners.get(file);
      if (owner !== undefined) throw new Error(`${file} is planned for shards ${owner} and ${position + 1}`);
      owners.set(file, position + 1);
    }
  });
  plans.forEach((files, position) => {
    const label = `Shard ${position + 1}/${plans.length}`;
    const reported = new Set(Object.keys(reports[position]?.files ?? {}));
    const missing = files.filter(file => !reported.has(file));
    if (missing.length > 0) throw new Error(`${label} reported no mutants for ${missing.join(', ')}, which it planned: Stryker matched no file or found nothing to mutate`);
    const planned = new Set(files);
    const unplanned = [...reported].filter(file => !planned.has(file));
    if (unplanned.length > 0) throw new Error(`${label} reported ${unplanned.join(', ')}, which it did not plan`);
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
  /** @param {number} index @param {string} name */
  const read = (index, name) => {
    const path = join(dir, `shard-${index}`, name);
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  };
  const reports = loadShardReports(options.shards, index => read(index, 'mutation.json'), present);
  checkPlans(loadShardPlans(options.shards, index => read(index, 'plan.json')), reports);
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
