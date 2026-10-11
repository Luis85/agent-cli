import { spawn, spawnSync } from 'node:child_process';

/** Grace period between the polite and the forced termination of a timed-out process tree. */
const graceMs = 2000;
const windows = process.platform === 'win32';

/**
 * Ends `child` and every process it started. On POSIX that is the process group the child leads (it was spawned
 * detached), which outlives the child while members run, so it is signaled even after the child exited. On Windows
 * `taskkill /T` walks the tree from the child, so it runs only while the child runs: an exited child's id may already
 * name another process, and its orphaned descendants are out of reach. A group that has already exited is no error.
 * @param {import('node:child_process').ChildProcess} child @param {NodeJS.Signals} signal
 */
function killTree(child, signal) {
  if (child.pid === undefined) return;
  if (windows) {
    if (child.exitCode === null && child.signalCode === null) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, signal); }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error; }
}

/** Agents of the runs in progress, each with the promise of its exit; `stopping` once a signal ends the driver. */
const running = new Map();
let stopping = false;
const forwarded = /** @type {const} */ (['SIGINT', 'SIGTERM']);
/**
 * A SIGINT or SIGTERM to the driver (Ctrl+C in a terminal) reaches no agent, because each leads its own process
 * group. While runs are in progress, the driver forwards the signal to every agent group, force-ends the groups that
 * still run after the grace period, and then ends itself with the same signal.
 * @param {NodeJS.Signals} signal
 */
function interrupted(signal) {
  stopping = true;
  for (const name of forwarded) process.removeListener(name, interrupted);
  const agents = [...running.keys()];
  for (const child of agents) killTree(child, signal);
  const forced = setTimeout(() => { for (const child of agents) killTree(child, 'SIGKILL'); }, graceMs);
  void Promise.all(running.values()).then(() => { clearTimeout(forced); process.kill(process.pid, signal); });
}
/** @param {import('node:child_process').ChildProcess} child @param {Promise<void>} exited */
function track(child, exited) {
  if (running.size === 0) for (const name of forwarded) process.on(name, interrupted);
  running.set(child, exited);
}
/** @param {import('node:child_process').ChildProcess} child */
function untrack(child) {
  running.delete(child);
  if (running.size === 0) for (const name of forwarded) process.removeListener(name, interrupted);
}

/** A failed or timed-out headless run; `timedOut` names a run the driver ended. */
export class HeadlessError extends Error {
  /** @param {string} message @param {boolean} timedOut */
  constructor(message, timedOut) { super(message); this.timedOut = timedOut; }
}

/**
 * Names whose values must never appear in a report: tokens, keys, secrets, passwords and personal access tokens.
 * @param {string} name
 */
const secretName = name => /TOKEN|KEY|SECRET|PASSWORD|(^|_)PAT($|_)|CREDENTIAL/i.test(name);

/**
 * `text` with the value of every secret-named environment variable replaced by `***`.
 * @param {string} text @param {NodeJS.ProcessEnv} env
 */
export function redact(text, env = process.env) {
  let result = text;
  for (const [name, value] of Object.entries(env)) if (secretName(name) && value !== undefined && value.length >= 4) result = result.replaceAll(value, '***');
  return result;
}

/**
 * Runs `executable` in its own process group and resolves its standard output. At `timeoutMs` the whole group is
 * terminated (SIGTERM, then SIGKILL after a grace period), so tool processes the agent started never outlive the
 * attempt, and the run fails with a `timedOut` HeadlessError. After a normal exit, leftover group members are
 * killed too (POSIX only; see killTree). A SIGINT or SIGTERM to the driver ends the group first (see interrupted).
 * A nonzero exit without a `result` event fails with its redacted standard error.
 * @param {string} executable @param {string[]} args @param {string} cwd @param {number} timeoutMs @returns {Promise<string>}
 */
export function headless(executable, args, cwd, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    // The driver is ending on a signal: no further agent starts.
    if (stopping) { reject(new HeadlessError(`${executable} was not started; the driver is ending on a signal.`, false)); return; }
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: !windows, windowsHide: true });
    /** @type {Buffer[]} */ const stdout = [];
    /** @type {Buffer[]} */ const stderr = [];
    let timedOut = false;
    /** @type {NodeJS.Timeout | undefined} */ let forced;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, 'SIGTERM');
      forced = setTimeout(() => killTree(child, 'SIGKILL'), graceMs);
    }, timeoutMs);
    track(child, new Promise(resolveExit => { child.once('close', () => resolveExit(undefined)); child.once('error', () => resolveExit(undefined)); }));
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => { clearTimeout(timer); clearTimeout(forced); untrack(child); reject(error); });
    // Once the agent process exits, members of its group that still run (and may hold its output open) end too.
    child.on('exit', () => killTree(child, 'SIGKILL'));
    child.on('close', (status, signal) => {
      clearTimeout(timer); clearTimeout(forced); untrack(child);
      const text = Buffer.concat(stdout).toString('utf8');
      if (timedOut) reject(new HeadlessError(`${executable} timed out after ${timeoutMs / 1000} s; its process group was terminated (${signal ?? `exit ${status}`}).`, true));
      else if (status !== 0 && !text.includes('"type":"result"')) reject(new HeadlessError(`${executable} exited ${status ?? signal}: ${redact(Buffer.concat(stderr).toString('utf8')).slice(0, 2000)}`, false));
      else resolvePromise(text);
    });
  });
}
