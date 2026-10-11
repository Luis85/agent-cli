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
  // macOS reports EPERM rather than ESRCH for a group whose remaining members are unreaped zombies.
  try { process.kill(-child.pid, signal); }
  catch (error) { if (!['ESRCH', 'EPERM'].includes(/** @type {string} */ (/** @type {NodeJS.ErrnoException} */ (error).code))) throw error; }
}

/** Agents of the runs in progress, each with the promise of its exit. */
const running = new Map();
/** Work the driver completes before it ends on a signal (see completeBeforeSignal). */
const pending = new Set();
/** @type {NodeJS.Signals | null} The signal the driver is ending on. */
let signaled = null;
let listening = false;
const forwarded = /** @type {const} */ (['SIGINT', 'SIGTERM']);

/** The driver listens for signals while agents run or work is pending, until the first signal arrives. */
function listen() {
  const wanted = signaled === null && running.size + pending.size > 0;
  if (wanted === listening) return;
  listening = wanted;
  for (const name of forwarded) {
    if (wanted) process.on(name, interrupted);
    else process.removeListener(name, interrupted);
  }
}

/**
 * A SIGINT or SIGTERM to the driver (Ctrl+C in a terminal) reaches no agent, because each leads its own process
 * group. The driver forwards the signal to every agent group and force-ends the groups that still run after the
 * grace period. Once they have exited it completes the pending work, such as removing an attempt's temporary folders
 * and writing a partial report, and then ends itself with the same signal. A second signal ends it at once.
 * @param {NodeJS.Signals} signal
 */
function interrupted(signal) {
  signaled = signal;
  listen();
  const agents = [...running.keys()];
  for (const child of agents) killTree(child, signal);
  const forced = setTimeout(() => { for (const child of agents) killTree(child, 'SIGKILL'); }, graceMs);
  void Promise.all(running.values()).then(async () => {
    clearTimeout(forced);
    while (pending.size > 0) await Promise.allSettled(pending);
    process.kill(process.pid, signal);
  });
}

/** The signal the driver is ending on, or null. */
export const interruption = () => signaled;

/**
 * Registers `work` that a SIGINT or SIGTERM lets finish before the driver ends with that signal, and returns it.
 * While work is pending the driver handles these signals, so its cleanup (`finally` blocks) runs.
 * @template T @param {Promise<T>} work @returns {Promise<T>}
 */
export function completeBeforeSignal(work) {
  pending.add(work);
  listen();
  const done = () => { pending.delete(work); listen(); };
  work.then(done, done);
  return work;
}

/** @param {import('node:child_process').ChildProcess} child @param {Promise<void>} exited */
function track(child, exited) {
  running.set(child, exited);
  listen();
}
/** @param {import('node:child_process').ChildProcess} child */
function untrack(child) {
  running.delete(child);
  listen();
}

/** A failed or timed-out headless run; `timedOut` names a run the driver ended, `interrupted` one a signal ended. */
export class HeadlessError extends Error {
  /** @param {string} message @param {boolean} timedOut @param {boolean} [interrupted] */
  constructor(message, timedOut, interrupted = false) { super(message); this.timedOut = timedOut; this.interrupted = interrupted; }
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
 * terminated (SIGTERM, then SIGKILL after a grace period; on Windows `taskkill /T /F` ends the tree), so tool
 * processes the agent started never outlive the attempt, and the run fails with a `timedOut` HeadlessError. After a
 * normal exit, leftover group members are killed too (POSIX only; see killTree). A SIGINT or SIGTERM to the driver
 * ends the group first and fails the run with an `interrupted` HeadlessError (see interrupted).
 * A nonzero exit without a `result` event fails with its redacted standard error.
 * @param {string} executable @param {string[]} args @param {string} cwd @param {number} timeoutMs @returns {Promise<string>}
 */
export function headless(executable, args, cwd, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    // The driver is ending on a signal: no further agent starts.
    if (signaled !== null) { reject(new HeadlessError(`${executable} was not started; the driver is ending on ${signaled}.`, false, true)); return; }
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
      const ended = signal ?? `exit ${status}`;
      if (timedOut) reject(new HeadlessError(`${executable} timed out after ${timeoutMs / 1000} s; ${windows ? 'its process tree was ended with taskkill' : 'its process group was terminated'} (${ended}).`, true));
      else if (signaled !== null) reject(new HeadlessError(`${executable} was ended by the driver's ${signaled} (${ended}).`, false, true));
      else if (status !== 0 && !text.includes('"type":"result"')) reject(new HeadlessError(`${executable} exited ${status ?? signal}: ${redact(Buffer.concat(stderr).toString('utf8')).slice(0, 2000)}`, false));
      else resolvePromise(text);
    });
  });
}
