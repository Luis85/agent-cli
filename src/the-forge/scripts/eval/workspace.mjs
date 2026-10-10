import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { asStep, evalsRoot, projectRoot } from './tasks.mjs';

/**
 * @typedef {import('./tasks.mjs').Task} Task
 * @typedef {import('./tasks.mjs').Args} Args
 * @typedef {{ status: number | null, body: any, stdout: string }} ForgeResult
 * @typedef {{
 *   root: string, forge: (args: Args) => Promise<ForgeResult>, expand: (text: string) => Promise<string>,
 *   prepared: (path: string) => Buffer | undefined, vaultPaths: string[], dispose: () => Promise<void>,
 * }} EvalWorkspace
 */

/** The workspace `bin/` that `npm run build` writes, named by `config.distribution` in package.json. */
export async function distributionPath() {
  const { config } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
  return resolve(projectRoot, config.distribution);
}

const sha256 = (/** @type {Buffer} */ bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {string} root @param {string} [prefix] @returns {Promise<string[]>} */
async function files(root, prefix = '') {
  const paths = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await files(root, path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

/**
 * Runs the workspace's own `bin/forge.js` with `--root` and `--json` and parses the envelope.
 * @param {string} root @param {Args} args @returns {Promise<ForgeResult>}
 */
function runForge(root, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(root, 'bin/forge.js'), '--root', root, '--json', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    /** @type {Buffer[]} */ const stdout = [];
    /** @type {Buffer[]} */ const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', status => {
      const text = Buffer.concat(stdout).toString('utf8');
      try { resolvePromise({ status, body: JSON.parse(text), stdout: text }); }
      catch { reject(new Error(`forge ${args.join(' ')} returned no JSON (exit ${status}): ${Buffer.concat(stderr).toString('utf8') || text}`)); }
    });
  });
}

/**
 * Whether a result meets a step's expectation: success, or the expected failure code.
 * @param {ForgeResult} result @param {{ code: string } | undefined} expect
 */
export function meets(result, expect) {
  return expect === undefined ? result.status === 0 && result.body.ok === true : result.body.ok === false && result.body.error?.code === expect.code;
}

/**
 * A fresh workspace for one task: a copy of the built distribution with its default configuration, the task's
 * fixture, `setup` (agent skills, templates and AGENTS.md as a real installation has them) and the task's own setup
 * steps. Placeholders `{{revision:path}}` (the file's current SHA-256) and `{{initial:path}}` (its revision in the
 * fixture, before setup) expand in prompts and reference arguments.
 * @param {Task} task @param {{ distribution?: string }} [options] @returns {Promise<EvalWorkspace>}
 */
export async function createWorkspace(task, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), `forge-eval-${task.id}-`)));
  try {
    await cp(options.distribution ?? await distributionPath(), join(root, 'bin'), { recursive: true });
    // A generic installation: no checkout configuration or project selection.
    await copyFile(join(root, 'bin/config/default.json'), join(root, 'bin/config.json'));
    await rm(join(root, 'bin/data/context.json'), { force: true });
    const fixture = join(evalsRoot, 'fixtures', task.fixture);
    await cp(fixture, root, { recursive: true });
    /** @type {Map<string, string>} */
    const initial = new Map();
    for (const path of await files(fixture)) initial.set(path, sha256(await readFile(join(fixture, path))));
    const forge = (/** @type {Args} */ args) => runForge(root, args);
    const expand = async (/** @type {string} */ text) => {
      let result = text;
      for (const match of text.matchAll(/\{\{(revision|initial):([^}]+)\}\}/g)) {
        const [placeholder, kind, path = ''] = match;
        const value = kind === 'initial' ? initial.get(path) : sha256(await readFile(join(root, path)));
        if (value === undefined) throw new Error(`${task.id}: ${placeholder} names no fixture file`);
        result = result.replace(placeholder, value);
      }
      return result;
    };
    for (const step of [['setup'], ...task.setup ?? []].map(asStep)) {
      const result = await forge(await Promise.all(step.run.map(expand)));
      if (!meets(result, step.expect)) throw new Error(`${task.id} setup ${step.run.join(' ')} failed: ${JSON.stringify(result.body.error ?? result.body)}`);
    }
    /** @type {Map<string, Buffer>} */
    const prepared = new Map();
    for (const path of await files(root)) if (!path.startsWith('bin/')) prepared.set(path, await readFile(join(root, path)));
    // The fixture's own files outside hidden folders: the paths an answer about the vault may name.
    const vaultPaths = [...initial.keys()].filter(path => !path.split('/').some(segment => segment.startsWith('.')) && !path.startsWith('bin/')).sort();
    return { root, forge, expand, prepared: path => prepared.get(path), vaultPaths, dispose: () => rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
