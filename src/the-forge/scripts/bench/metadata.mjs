// Benchmark the metadata-heavy commands of the built CLI on a deterministic synthetic vault.
// Run from src/the-forge after `npm run build`; prints one JSON report on stdout.
//
//   node scripts/bench/metadata.mjs                     2,000 notes, 100 images and one Base (2,101 files)
//   node scripts/bench/metadata.mjs --large             4,000 notes, 500 images and one Base (4,501 files)
//   node scripts/bench/metadata.mjs --notes 500 --attachments 20 --runs 5
//   node scripts/bench/metadata.mjs --forge path/to/forge.js --keep
//
// Every command runs once cold (the workspace's .forge/cache removed first) and then `--runs` times warm, after an
// unmeasured `links unresolved` has stored the metadata cache (search reuses it but never stores it). The vault is
// generated in a temporary directory, used as the workspace root with a minimal bin/config.json, and removed
// afterwards unless --keep is given. Wall times depend on machine load; the CPU times (user plus system time of the
// CLI process, reported by a preloaded probe) much less so. Compare builds on the same machine.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateVault } from './vault.mjs';

const forgeProject = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const distribution = resolve(forgeProject, JSON.parse(readFileSync(join(forgeProject, 'package.json'), 'utf8')).config.distribution);

/** The measured commands: the metadata index, link reports, a filtered search and a Bases view. */
const commands = [
  ['vault', 'check'],
  ['links', 'unresolved'],
  ['search', 'details', '--tag', 't3', '--limit', '20'],
  ['bases', 'query', 'bases/Notes.base', '--view', 'Active'],
];

function options() {
  const { values } = parseArgs({
    options: {
      notes: { type: 'string' }, attachments: { type: 'string' }, runs: { type: 'string', default: '3' },
      large: { type: 'boolean', default: false }, forge: { type: 'string' }, keep: { type: 'boolean', default: false },
    },
  });
  const count = (/** @type {string | undefined} */ value, /** @type {number} */ fallback, /** @type {string} */ name) => {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(number) || number < 0) throw new Error(`--${name} must be a nonnegative integer.`);
    return number;
  };
  return {
    notes: count(values.notes, values.large ? 4000 : 2000, 'notes'),
    attachments: count(values.attachments, values.large ? 500 : 100, 'attachments'),
    runs: Math.max(1, count(values.runs, 3, 'runs')),
    forge: resolve(values.forge ?? join(distribution, 'forge.js')),
    keep: values.keep === true,
  };
}

/** Preloaded into every run: reports the process's own CPU time on exit, which machine load does not inflate. */
const cpuProbe = `process.on('exit', () => { const { user, system } = process.cpuUsage(); process.stderr.write('\\nforge-bench-cpu ' + Math.round((user + system) / 1000) + '\\n'); });\n`;

/**
 * One CLI run: wall and CPU time in milliseconds and a short outcome.
 * @param {string} forge @param {string} root @param {string[]} args
 */
function run(forge, root, args) {
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, ['--require', join(root, 'bin', 'cpu-probe.cjs'), forge, '--root', root, ...args, '--json'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const cpuMs = Number(/forge-bench-cpu (\d+)/.exec(result.stderr)?.[1] ?? Number.NaN);
  let outcome;
  try {
    const body = JSON.parse(result.stdout);
    outcome = body.ok ? { ok: true, warnings: body.warnings.length } : { ok: false, error: body.error.code };
  } catch { outcome = { ok: false, error: `unparseable output (exit ${result.status}): ${result.stderr.slice(0, 200)}` }; }
  return { ms: Math.round(ms), cpuMs, ...outcome };
}

const median = (/** @type {number[]} */ values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function main() {
  const settings = options();
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forge-bench-')));
  try {
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin', 'config.json'), `${JSON.stringify({ schemaVersion: 1, settings: { language: 'en' } }, null, 2)}\n`);
    writeFileSync(join(root, 'bin', 'cpu-probe.cjs'), cpuProbe);
    const files = generateVault(root, settings);
    const results = commands.map(args => {
      rmSync(join(root, '.forge', 'cache'), { recursive: true, force: true });
      const cold = run(settings.forge, root, args);
      run(settings.forge, root, ['links', 'unresolved']);
      const warm = Array.from({ length: settings.runs }, () => run(settings.forge, root, args));
      return {
        command: args.join(' '), coldMs: cold.ms, coldCpuMs: cold.cpuMs, warmMs: warm.map(item => item.ms), warmMedianMs: median(warm.map(item => item.ms)),
        warmCpuMs: warm.map(item => item.cpuMs), warmMedianCpuMs: median(warm.map(item => item.cpuMs)),
        ok: cold.ok && warm.every(item => item.ok), ...(cold.ok ? { warnings: cold.warnings } : { error: cold.error }),
      };
    });
    const report = { forge: settings.forge, node: process.version, vault: { notes: settings.notes, attachments: settings.attachments, files }, runs: settings.runs, results, ...(settings.keep ? { root } : {}) };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (!settings.keep) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

main();
