import { spawn, spawnSync } from 'node:child_process';

/** Grace period between the polite and the forced termination of a timed-out process tree. */
const graceMs = 2000;
const windows = process.platform === 'win32';

/**
 * Ends `pid` and every process it started: on POSIX the process group the child leads (it was spawned detached),
 * on Windows the tree `taskkill /T` walks. A group or tree that has already exited is no error.
 * @param {number} pid @param {'SIGTERM' | 'SIGKILL'} signal
 */
function killTree(pid, signal) {
  if (windows) { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return; }
  try { process.kill(-pid, signal); }
  catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error; }
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
 * killed too. A nonzero exit without a `result` event fails with its redacted standard error.
 * @param {string} executable @param {string[]} args @param {string} cwd @param {number} timeoutMs @returns {Promise<string>}
 */
export function headless(executable, args, cwd, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: !windows, windowsHide: true });
    /** @type {Buffer[]} */ const stdout = [];
    /** @type {Buffer[]} */ const stderr = [];
    let timedOut = false;
    /** @type {NodeJS.Timeout | undefined} */ let forced;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) return;
      killTree(child.pid, 'SIGTERM');
      forced = setTimeout(() => { if (child.pid !== undefined) killTree(child.pid, 'SIGKILL'); }, graceMs);
    }, timeoutMs);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => { clearTimeout(timer); clearTimeout(forced); reject(error); });
    // Once the agent process exits, members of its group that still run (and may hold its output open) end too.
    child.on('exit', () => { if (child.pid !== undefined) killTree(child.pid, 'SIGKILL'); });
    child.on('close', (status, signal) => {
      clearTimeout(timer); clearTimeout(forced);
      const text = Buffer.concat(stdout).toString('utf8');
      if (timedOut) reject(new HeadlessError(`${executable} timed out after ${timeoutMs / 1000} s; its process group was terminated (${signal ?? `exit ${status}`}).`, true));
      else if (status !== 0 && !text.includes('"type":"result"')) reject(new HeadlessError(`${executable} exited ${status ?? signal}: ${redact(Buffer.concat(stderr).toString('utf8').slice(0, 2000))}`, false));
      else resolvePromise(text);
    });
  });
}
