import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultAllowedTools, runClaude } from './claude.mjs';
import { runReference } from './reference.mjs';
import { evalsRoot, loadTasks } from './tasks.mjs';
import { distributionPath } from './workspace.mjs';

/**
 * `npm run eval -- [--driver reference|claude] [--task id]... [--category name]...` runs the agent evaluation
 * tasks in evals/tasks. The reference driver replays each task's reference commands and fails the process when a
 * task or check is invalid. The claude driver runs Claude Code headless (`claude -p`) on each task, `--repeat k`
 * times, and writes evals/results/<timestamp>.json; it needs an authenticated local `claude` and never runs in CI.
 * The agent may run only a guarded Forge wrapper pinned to the task's workspace (scripts/eval/guard.mjs) and the
 * native tools of `--allowed-tool` (default: Read, Glob and Grep).
 */
const usage = 'npm run eval -- [--driver reference|claude] [--task id]... [--category name]... [--concurrency n] [--repeat k] [--model id] [--max-turns n] [--timeout seconds] [--allowed-tool rule]... [--claude path]';
const { values } = parseArgs({
  options: {
    driver: { type: 'string', default: 'reference' }, task: { type: 'string', multiple: true }, category: { type: 'string', multiple: true },
    concurrency: { type: 'string', default: '4' }, repeat: { type: 'string', default: '1' }, model: { type: 'string' },
    'max-turns': { type: 'string', default: '30' }, timeout: { type: 'string', default: '600' }, 'allowed-tool': { type: 'string', multiple: true },
    claude: { type: 'string', default: 'claude' }, help: { type: 'boolean' },
  },
});
if (values.help) { process.stdout.write(`${usage}\n`); process.exit(0); }

/** @param {string} name @param {string} value */
function positive(name, value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`--${name} must be a positive integer`);
  return number;
}

/**
 * Runs `work` over `items` with at most `limit` in flight, keeping input order in the results.
 * @template T, R @param {T[]} items @param {number} limit @param {(item: T) => Promise<R>} work @returns {Promise<R[]>}
 */
async function pool(items, limit, work) {
  /** @type {R[]} */
  const results = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => { while (next < items.length) { const index = next++; results[index] = await work(/** @type {T} */ (items[index])); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const sum = (/** @type {Array<number | null>} */ numbers) => numbers.reduce((total, value) => /** @type {number} */ (total) + (value ?? 0), 0);

async function main() {
  const selected = loadTasks().filter(task => (!values.task || values.task.includes(task.id)) && (!values.category || values.category.includes(task.category)));
  if (selected.length === 0) throw new Error('No task matches the selection.');
  const distribution = await distributionPath();
  if (values.driver === 'reference') {
    const results = await pool(selected, positive('concurrency', values.concurrency), task => runReference(task, { distribution }));
    const failed = results.filter(result => !result.passed);
    process.stdout.write(`${JSON.stringify({ driver: 'reference', ok: failed.length === 0, tasks: results.length, passed: results.length - failed.length, failures: failed.map(({ id, failures }) => ({ id, failures })) }, null, 2)}\n`);
    process.exitCode = failed.length === 0 ? 0 : 1;
    return;
  }
  if (values.driver !== 'claude') throw new Error(`Unknown driver ${values.driver}. ${usage}`);
  if (process.env.CI) throw new Error('The claude driver is opt-in and never runs in CI.');
  const repeat = positive('repeat', values.repeat);
  const options = {
    model: values.model, maxTurns: positive('max-turns', values['max-turns']), timeoutMs: positive('timeout', values.timeout) * 1000,
    allowedTools: values['allowed-tool'] ?? defaultAllowedTools, executable: values.claude, distribution,
  };
  const runs = selected.flatMap(task => Array.from({ length: repeat }, (_, attempt) => ({ task, attempt: attempt + 1 })));
  // Sequential: concurrent agents would compete for the same account limits and skew durations.
  const results = await pool(runs, 1, ({ task, attempt }) => runClaude(task, options, attempt));
  const tasks = selected.map(task => {
    const attempts = results.filter(result => result.id === task.id);
    return { id: task.id, category: task.category, passes: attempts.filter(result => result.passed).length, attempts: attempts.length, passAll: attempts.every(result => result.passed) };
  });
  const summary = {
    driver: 'claude', model: values.model ?? null, repeat, startedTasks: selected.length,
    passRate: results.filter(result => result.passed).length / results.length,
    passAllRate: tasks.filter(task => task.passAll).length / tasks.length,
    turns: sum(results.map(result => result.transcript.turns)), costUsd: sum(results.map(result => result.transcript.costUsd)),
    tokens: Object.fromEntries((/** @type {const} */ (['input', 'output', 'cacheRead', 'cacheCreation'])).map(kind => [kind, sum(results.map(result => result.transcript.tokens?.[kind] ?? null))])),
    toolCalls: { forge: sum(results.map(result => result.transcript.toolCalls.forge)), otherBash: sum(results.map(result => result.transcript.toolCalls.otherBash)), native: sum(results.map(result => sum(Object.values(result.transcript.toolCalls.native)))) },
    forgeErrors: results.flatMap(result => result.transcript.forgeErrors).length,
  };
  const directory = join(evalsRoot, 'results');
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${new Date().toISOString().replaceAll(':', '-')}.json`);
  await writeFile(file, `${JSON.stringify({ summary, tasks, results }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...summary, results: file, tasks }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
