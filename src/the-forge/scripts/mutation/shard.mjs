/**
 * Runs one shard of the mutation scope, so CI can test the files that `stryker.config.json` `mutate` selects in
 * parallel jobs. Run from src/the-forge:
 *
 *   node scripts/mutation/shard.mjs --shard 1/2 [--force] [--config stryker.config.json] [--dir .quality-reports/mutation]
 *   node scripts/mutation/shard.mjs --list 2      print the partition as JSON without running Stryker
 *
 * The files are partitioned deterministically and balanced by size. Shard i records its files in
 * `<dir>/shard-<i>/plan.json`, which the merge (scripts/mutation/merge.mjs) compares with the report, and runs Stryker
 * through its API with the configuration file plus overrides: `mutate` lists only its files, reports and the
 * incremental file go to `<dir>/shard-<i>/`, and `thresholds.break` is null because only the merged score is judged.
 * Before the run, the shard's incremental file is seeded from every incremental file present under `<dir>` (the full
 * run's and each shard's), restricted to the shard's own files: a file that moved to another shard keeps its earlier
 * results, and a shard never carries over results of files it no longer owns.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Minimatch } from 'minimatch';
import { mergeReports } from './report.mjs';

/** Stryker's `file:startLine[:column]-endLine[:column]` mutate range suffix. */
const RANGE = /:\d+(?::\d+)?-\d+(?::\d+)?$/;

/** What Stryker never reads, whatever the configuration (`ALWAYS_IGNORE` in @stryker-mutator/core's project reader). */
const ALWAYS_IGNORE = ['node_modules', '.git', '*.tsbuildinfo', '/stryker.log', '.next', '.nuxt', '.svelte-kit'];

/**
 * The ignore rules Stryker applies to a configuration besides ALWAYS_IGNORE: its sandbox, incremental file, reports
 * and `ignorePatterns`.
 * @param {{ tempDirName?: string, incrementalFile?: string, htmlReporter?: { fileName?: string }, jsonReporter?: { fileName?: string }, ignorePatterns?: string[] }} config
 */
export function ignoreRules(config) {
  return [config.tempDirName, config.incrementalFile, config.htmlReporter?.fileName, config.jsonReporter?.fileName, ...(config.ignorePatterns ?? [])]
    .filter(rule => typeof rule === 'string');
}

/**
 * The files Stryker reads from a project, as project-relative paths with `/`. Like its project reader, this walks the
 * directory tree and skips each entry that the ignore rules (gitignore-style minimatch patterns, case-insensitive, `!`
 * re-includes) match by name or path.
 * @param {string} cwd @param {string[]} ignore
 */
export function projectFiles(cwd, ignore) {
  const rules = [...ALWAYS_IGNORE, ...ignore].map(pattern => new Minimatch(pattern, { dot: true, flipNegate: true, nocase: true }));
  /** @param {string} name @param {string} path @param {Minimatch} rule */
  const matchesFile = (name, path, rule) => rule.match(name) || rule.match(path) || rule.match(`/${path}`);
  /** @param {string} name @param {string} path @param {Minimatch} rule */
  const matchesDirectory = (name, path, rule) => matchesFile(name, path, rule) || rule.match(`/${path}/`) || rule.match(`${path}/`)
    || (rule.negate && (rule.match(`/${path}`, true) || rule.match(path, true)));
  /** @type {string[]} */
  const files = [];
  /** @param {string} directory */
  const visit = directory => {
    for (const entry of readdirSync(join(cwd, directory), { withFileTypes: true })) {
      const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
      let included = true;
      for (const rule of rules) {
        if (rule.negate === included) continue;
        if (entry.isDirectory() ? matchesDirectory(entry.name, path, rule) : matchesFile(entry.name, path, rule)) included = rule.negate;
      }
      if (!included) continue;
      if (entry.isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit('');
  return files;
}

/**
 * Expands `mutate` over the project's files like Stryker. Returns project-relative paths with `/`, sorted.
 * @param {string[]} patterns @param {string} cwd @param {string[]} [ignore] ignore rules besides ALWAYS_IGNORE
 */
export function selectFiles(patterns, cwd, ignore = []) {
  return matchFiles(patterns, projectFiles(cwd, ignore), cwd);
}

/**
 * Applies `mutate` patterns to project files like Stryker: each pattern is resolved against the project directory and
 * matched with minimatch, case-sensitively and without letting wildcards match dot files; patterns apply in order, and
 * one starting with `!` removes the files selected so far that it matches. Returns the selected files, sorted.
 * @param {string[]} patterns @param {string[]} files project-relative paths with `/` @param {string} cwd
 */
export function matchFiles(patterns, files, cwd) {
  /** @param {string} path */
  const absolute = path => resolve(cwd, path).replaceAll('\\', '/');
  /** @type {Set<string>} */
  const selected = new Set();
  for (const pattern of patterns) {
    if (RANGE.test(pattern)) throw new Error(`Sharded runs select whole files; remove the line range from mutate pattern "${pattern}"`);
    const negated = pattern.startsWith('!');
    const matcher = new Minimatch(absolute(negated ? pattern.slice(1) : pattern), { dot: false });
    for (const file of negated ? [...selected] : files) {
      if (!matcher.match(absolute(file))) continue;
      if (negated) selected.delete(file);
      else selected.add(file);
    }
  }
  return [...selected].sort();
}

/**
 * Greedy longest-processing-time partition: files sorted by size (largest first, ties by path) each go to the shard
 * with the smallest total so far (ties to the lowest shard). Each shard's files are returned sorted by path.
 * @param {Array<{ path: string, size: number }>} files @param {number} count
 * @returns {string[][]}
 */
export function partition(files, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error(`The shard count must be a positive integer, got ${count}`);
  const shards = Array.from({ length: count }, () => ({ size: 0, files: /** @type {string[]} */ ([]) }));
  const ordered = [...files].sort((a, b) => b.size - a.size || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of ordered) {
    const lightest = shards.reduce((best, shard) => shard.size < best.size ? shard : best);
    lightest.size += file.size;
    lightest.files.push(file.path);
  }
  return shards.map(shard => shard.files.sort());
}

/**
 * The file path as a mutate pattern that matches only that file. A path with glob syntax would need minimatch
 * escaping, so it is refused instead.
 * @param {string} file
 */
export function literalPattern(file) {
  if (/[*?[\]{}()!+@\\]/.test(file)) throw new Error(`Cannot shard ${file}: its path contains glob syntax`);
  return file;
}

/**
 * Parses the command line: `--shard <i>/<n>` or `--list <n>`, plus `--force`, `--config <file>` and `--dir <dir>`.
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{ shard?: { index: number, count: number }, list?: number, force: boolean, config: string, dir: string }} */
  const options = { force: false, config: 'stryker.config.json', dir: '.quality-reports/mutation' };
  for (let position = 0; position < args.length; position++) {
    const arg = args[position];
    const value = () => {
      const next = args[++position];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--force') options.force = true;
    else if (arg === '--config') options.config = value();
    else if (arg === '--dir') options.dir = value();
    else if (arg === '--list') options.list = positive(value(), '--list');
    else if (arg === '--shard') {
      const match = /^(\d+)\/(\d+)$/.exec(value());
      const index = Number(match?.[1]);
      const count = Number(match?.[2]);
      if (!match || index < 1 || index > count) throw new Error('--shard must be <index>/<count> with 1 <= index <= count, for example 1/2');
      options.shard = { index, count };
    } else throw new Error(`Unknown argument ${arg}`);
  }
  if ((options.shard === undefined) === (options.list === undefined)) throw new Error('Usage: node scripts/mutation/shard.mjs --shard <index>/<count> [--force] [--config <file>] [--dir <dir>] | --list <count>');
  return options;
}

/** @param {string} text @param {string} flag */
function positive(text, flag) {
  const count = Number(text);
  if (!/^\d+$/.test(text) || count < 1) throw new Error(`${flag} needs a positive integer`);
  return count;
}

/**
 * The partition of the configured scope in a project directory.
 * @param {{ mutate?: string[] } & Parameters<typeof ignoreRules>[0]} config @param {number} count @param {string} cwd
 */
export function planShards(config, count, cwd) {
  if (!Array.isArray(config.mutate) || config.mutate.length === 0) throw new Error('The Stryker configuration must list mutate patterns');
  const files = selectFiles(config.mutate, cwd, ignoreRules(config));
  if (files.length === 0) throw new Error('The mutate patterns select no file');
  return partition(files.map(path => ({ path, size: statSync(join(cwd, path)).size })), count);
}

/**
 * Records the shard's files in `<dir>/shard-<index>/plan.json`, so the merge can tell a file that Stryker silently
 * skipped from one that no shard planned.
 * @param {string} dir @param {number} index @param {number} count @param {string[]} files
 */
export function writePlan(dir, index, count, files) {
  mkdirSync(join(dir, `shard-${index}`), { recursive: true });
  writeFileSync(join(dir, `shard-${index}`, 'plan.json'), `${JSON.stringify({ shard: index, shards: count, files }, null, 2)}\n`);
}

/**
 * Seeds `<dir>/shard-<index>/incremental.json` from every incremental file under `<dir>`, keeping only the shard's
 * files. For a file in several of them, the one recorded against the current source wins, otherwise the first found.
 * Returns the number of seeded files.
 * @param {string} dir @param {number} index @param {string[]} files @param {string} cwd
 */
export function seedIncremental(dir, index, files, cwd) {
  const own = join(dir, `shard-${index}`, 'incremental.json');
  const sources = [own, join(dir, 'incremental.json'), ...readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^shard-\d+$/.test(entry.name) && entry.name !== `shard-${index}`)
    .map(entry => join(dir, entry.name, 'incremental.json')).sort()];
  const reports = sources.filter(path => existsSync(path)).map(path => JSON.parse(readFileSync(path, 'utf8')));
  if (reports.length === 0) return 0;
  const wanted = new Set(files);
  const seeded = mergeReports(reports, {
    keepFile: path => wanted.has(path),
    prefer: (path, candidates) => {
      const current = readFileSync(join(cwd, path), 'utf8');
      return candidates.find(file => file.source === current) ?? /** @type {import('./report.mjs').FileResult} */ (candidates[0]);
    },
    allTests: false,
  });
  mkdirSync(join(dir, `shard-${index}`), { recursive: true });
  writeFileSync(own, JSON.stringify(seeded));
  return Object.keys(seeded.files).length;
}

/**
 * Stryker options for one shard, layered over the configuration file.
 * @param {{ tempDirName?: string, thresholds?: { high?: number, low?: number } }} config
 * @param {{ configFile: string, dir: string, index: number, files: string[], force: boolean }} shard
 */
export function shardOptions(config, { configFile, dir, index, files, force }) {
  const output = `${dir}/shard-${index}`;
  return {
    configFile,
    mutate: files.map(literalPattern),
    incrementalFile: `${output}/incremental.json`,
    htmlReporter: { fileName: `${output}/index.html` },
    jsonReporter: { fileName: `${output}/mutation.json` },
    tempDirName: `${config.tempDirName ?? '.stryker-tmp'}-shard-${index}`,
    thresholds: { ...config.thresholds, break: null },
    ...(force ? { force: true } : {}),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const config = JSON.parse(readFileSync(resolve(cwd, options.config), 'utf8'));
  if (options.list !== undefined) {
    process.stdout.write(`${JSON.stringify(planShards(config, options.list, cwd), null, 2)}\n`);
    return;
  }
  const { index, count } = /** @type {{ index: number, count: number }} */ (options.shard);
  const files = /** @type {string[]} */ (planShards(config, count, cwd)[index - 1]);
  if (files.length === 0) throw new Error(`Shard ${index}/${count} has no files; use fewer shards`);
  writePlan(join(cwd, options.dir), index, count, files);
  // Seed even with --force: Stryker carries results of files outside `mutate` over from the incremental file.
  const seeded = seedIncremental(join(cwd, options.dir), index, files, cwd);
  process.stdout.write(`Shard ${index}/${count}: ${files.length} files, incremental results seeded for ${seeded}\n${files.map(file => `  ${file}`).join('\n')}\n`);
  const dir = relative(cwd, resolve(cwd, options.dir)).split(sep).join('/');
  const { Stryker } = await import('@stryker-mutator/core');
  await new Stryker(shardOptions(config, { configFile: options.config, dir, index, files, force: options.force })).runMutationTest();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
