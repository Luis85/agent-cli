import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const maxBuffer = 64 * 1024 * 1024;
const env = { ...process.env, NO_COLOR: '1' };

/** Values longer than this are abbreviated in the recorded build log. */
const loggedValueLimit = 48;
const verboseOptions = new Set(['--content', '--set', '--value', '--values', '--metadata', '--prompt', '--find', '--replace']);

/**
 * Drive the bundled CLI against one isolated workspace. Every invocation
 * passes `--root` and `--json`, checks the exit status and the envelope's
 * `ok`, and fails loudly with the CLI's own error. Commands are recorded
 * (without routing flags) so the showcase can document how it was built.
 * @param {string} executable @param {string} workspace @param {string} projectDirectory
 */
export function forgeCli(executable, workspace, projectDirectory) {
  const projectPrefix = `${projectDirectory}/`;
  /** @type {{ section: string, command: string }[]} */
  const log = [];
  let section = 'Setup';
  /** Revisions reported by committed changes, keyed by project-relative path. @type {Map<string, string>} */
  const revisions = new Map();

  /** @param {string[]} args */
  const argv = args => [executable, '--root', workspace, ...args, '--json'];

  /** @param {unknown} changes */
  function remember(changes) {
    if (!Array.isArray(changes)) return;
    for (const change of changes) {
      if (typeof change?.path !== 'string') continue;
      const path = change.path.startsWith(projectPrefix) ? change.path.slice(projectPrefix.length) : change.path;
      if (typeof change.revision === 'string') revisions.set(path, change.revision);
      else revisions.delete(path);
    }
  }

  /**
   * Validate exit status and envelope, then record the command and its revisions.
   * @param {string[]} args @param {{ status: number | null, stdout: string, stderr: string }} result
   * @param {{ input?: string, record?: boolean }} options
   * @returns {any}
   */
  function accept(args, result, options) {
    /** @type {any} */
    let envelope;
    try { envelope = JSON.parse(result.stdout); }
    catch { throw new Error(`forge ${args.join(' ')} returned no JSON envelope (exit ${result.status}): ${result.stderr || result.stdout}`); }
    if (result.status !== 0 || envelope.ok !== true) {
      throw new Error(`forge ${args.join(' ')} failed (exit ${result.status}): ${JSON.stringify(envelope.error ?? envelope)}`);
    }
    if (options.record !== false) log.push({ section, command: describe(args, options.input !== undefined) });
    if (!args.includes('--dry-run')) remember(envelope.data?.changes);
    return envelope;
  }

  /**
   * Run one command and return its envelope.
   * @param {string[]} args @param {{ input?: string, record?: boolean }} [options]
   * @returns {any}
   */
  function run(args, options = {}) {
    const result = spawnSync(process.execPath, argv(args), { encoding: 'utf8', input: options.input, maxBuffer, env });
    if (result.error) throw result.error;
    return accept(args, result, options);
  }

  /**
   * The current revision of a project file: the one reported by the last
   * committed change, otherwise read through the CLI.
   * @param {string} path
   */
  function revision(path) {
    const known = revisions.get(path);
    if (known) return known;
    const current = run(['read', path], { record: false }).data?.revision;
    if (typeof current !== 'string') throw new Error(`read ${path} returned no revision`);
    return current;
  }

  return {
    log,
    run,
    /** @param {string} name */
    begin(name) { section = name; },

    /**
     * Run independent read-only commands (queries, drift checks) concurrently.
     * Results and log entries keep the given order.
     * @param {string[][]} commands
     * @returns {Promise<any[]>}
     */
    async runConcurrently(commands) {
      /** @type {{ status: number | null, stdout: string, stderr: string }[]} */
      const results = await Promise.all(commands.map(args => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, argv(args), { env, stdio: ['ignore', 'pipe', 'pipe'] });
        /** @type {Buffer[]} */ const stdout = [];
        /** @type {Buffer[]} */ const stderr = [];
        child.stdout.on('data', chunk => stdout.push(chunk));
        child.stderr.on('data', chunk => stderr.push(chunk));
        child.on('error', reject);
        child.on('close', status => resolve({ status, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }));
      })));
      return results.map((result, index) => accept(/** @type {string[]} */ (commands[index]), result, {}));
    },

    /**
     * Generated JSON/TypeScript content to transform before a guarded write.
     * Reading the workspace file directly keeps the script independent of the
     * read command's text/binary representation; all writes still go through the CLI.
     * @param {string} path
     */
    readText(path) { return readFileSync(join(workspace, projectPrefix, path), 'utf8'); },

    /** Replace a file through a revision-guarded write. @param {string} path @param {string} content */
    replace(path, content) { return run(['write', path, '--stdin', '--if-match', revision(path)], { input: content }); },

    /** Run a guarded command, appending `--if-match` with the file's current revision. @param {string} path @param {string[]} args */
    guarded(path, args) { return run([...args, '--if-match', revision(path)]); },

    /** Create a new file through the guarded create command. @param {string} path @param {string} content */
    create(path, content) { return run(['create', path, '--stdin'], { input: content }); },
  };
}

/** @typedef {ReturnType<typeof forgeCli>} ForgeCli */

/** @param {string[]} args @param {boolean} stdin */
function describe(args, stdin) {
  const parts = ['node bin/app.js'];
  for (let index = 0; index < args.length; index += 1) {
    const arg = /** @type {string} */ (args[index]);
    if (verboseOptions.has(arg) && index + 1 < args.length) {
      parts.push(arg, quote(abbreviate(/** @type {string} */ (args[index + 1]))));
      index += 1;
    } else if (arg === '--if-match' && index + 1 < args.length) {
      parts.push(arg, '<revision>');
      index += 1;
    } else parts.push(quote(arg));
  }
  if (stdin) parts.push('< input');
  return parts.join(' ');
}

/** @param {string} value */
function abbreviate(value) {
  const line = value.replace(/\s+/g, ' ');
  return line.length > loggedValueLimit ? `${line.slice(0, loggedValueLimit - 1)}…` : line;
}

/** @param {string} value */
function quote(value) {
  return /^[\w./:@=,+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
