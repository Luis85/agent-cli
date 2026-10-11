import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The guarded Forge entry point of the `claude` driver. A headless agent may run only this wrapper, which lives
 * outside the evaluation workspace so the agent cannot rewrite it through Forge writes. It pins `--root` to the
 * workspace, refuses options that reach outside it, runs Forge with a sandboxed home directory, and refuses to run
 * at all once the workspace's distribution (`bin/forge.js`, `bin/config.json`, plugins) has changed, so the agent
 * cannot enable a plugin or replace the executable with its own code.
 */

/** Options that would leave the evaluation workspace or reach the developer's Claude Code installation. */
const refusedOptions = ['--root', '--claude-dir', '--claude-bin'];

/**
 * Why the wrapper refuses `args`, or `undefined` when it may run them.
 * @param {readonly string[]} args @returns {string | undefined}
 */
export function refusal(args) {
  for (const [index, arg] of args.entries()) {
    if (arg === '--') break;
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (refusedOptions.includes(name)) return `${name} is not available in an evaluation workspace; the workspace root is fixed.`;
    if (name === '--scope' && (inline ?? args[index + 1]) === 'user') return '--scope user would change the user\'s own configuration; use the project scope.';
  }
  return undefined;
}

/**
 * A digest of the files that decide what code Forge runs: everything under `bin/` except editable templates,
 * packaged documentation and the project selection, which commands legitimately change.
 * @param {string} root @returns {Promise<string>}
 */
async function distributionDigest(root) {
  const hash = createHash('sha256');
  /** @param {string} prefix */
  const visit = async prefix => {
    const entries = (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      if (path === 'bin/templates' || path === 'bin/data/context.json' || path.endsWith('.md')) continue;
      if (entry.isDirectory()) await visit(path);
      else hash.update(`${path}\0`).update(await readFile(join(root, path))).update('\0');
    }
  };
  await visit('bin');
  return hash.digest('hex');
}

/** @param {string} message */
const refused = message => JSON.stringify({ ok: false, error: { code: 'EVAL_REFUSED', message, hint: 'Run Forge commands on files inside this workspace, without the refused option.', retryable: false } });

/**
 * Runs Forge for the wrapper: refusals and a changed distribution print a failure envelope and exit 2; otherwise
 * `node bin/forge.js --root <workspace> ...args` runs with standard input and output passed through and a home
 * directory inside the guard folder.
 * @param {{ root: string, digest: string, home: string }} guard @param {string[]} args
 */
async function runGuarded(guard, args) {
  const reason = refusal(args) ?? (await distributionDigest(guard.root) === guard.digest ? undefined : 'The Forge distribution under bin/ was modified in this workspace, so it no longer runs.');
  if (reason !== undefined) {
    process.stdout.write(`${refused(reason)}\n`);
    process.exitCode = 2;
    return;
  }
  const home = { HOME: guard.home, USERPROFILE: guard.home, XDG_CONFIG_HOME: join(guard.home, '.config'), CLAUDE_CONFIG_DIR: join(guard.home, '.claude') };
  const result = spawnSync(process.execPath, [join(guard.root, 'bin/forge.js'), '--root', guard.root, ...args], { cwd: guard.root, stdio: 'inherit', env: { ...process.env, ...home } });
  process.exitCode = result.status ?? 1;
}

/**
 * Installs the wrapper for one workspace in a new folder outside it: `node <folder>/forge.mjs <command>` is the
 * only shell command the agent may run. Call after the workspace is prepared, so the digest covers its setup.
 * @param {string} root @returns {Promise<{ entry: string, command: string, allowedTool: string, dispose: () => Promise<void> }>}
 */
export async function installGuard(root) {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'forge-eval-guard-')));
  const home = join(folder, 'home');
  await mkdir(home);
  const entry = join(folder, 'forge.mjs'), settings = join(folder, 'guard.json');
  await writeFile(settings, JSON.stringify({ root, digest: await distributionDigest(root), home }));
  // The entry runs this module as a script with the guard settings; both stay outside the workspace.
  const run = [fileURLToPath(import.meta.url), settings];
  await writeFile(entry, `import { spawnSync } from 'node:child_process';\nconst result = spawnSync(process.execPath, [...${JSON.stringify(run)}, ...process.argv.slice(2)], { stdio: 'inherit' });\nprocess.exitCode = result.status ?? 1;\n`);
  const command = `node ${entry}`;
  return { entry, command, allowedTool: `Bash(${command}:*)`, dispose: () => rm(folder, { recursive: true, force: true }) };
}

// `node guard.mjs <guard.json> ...args`, as the installed entry runs it.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [settings = '', ...args] = process.argv.slice(2);
  await runGuarded(JSON.parse(await readFile(settings, 'utf8')), args);
}
