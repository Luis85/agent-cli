import { afterAll, beforeAll, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { copyFile, cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distribution } from './workspace.ts';

interface Invocation { root?: string | null; entry?: string; cwd?: string; env?: Record<string, string> }
interface CliResult { status: number | null; body: any; stdout: string }

/** Every portable call finishes well within this; a hung child fails its test instead of the whole run. */
const callTimeout = 30_000;

/** Start Node with `args`, write `input` to its standard input and collect its output. */
function run(args: string[], cwd: string, input: string | Buffer | undefined, env: Record<string, string> = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, NODE_PATH: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`forge ${args.slice(1).join(' ')} did not finish within ${callTimeout} ms`));
    }, callTimeout);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    // A command that does not read its input may exit first: POSIX reports EPIPE, Windows EOF.
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', status => {
      clearTimeout(timer);
      resolve({ status, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
    child.stdin.end(input);
  });
}

/** Exercise a copied distribution under an ESM host with no installed packages. */
export function portableCli() {
  let project: string, bundle: string;
  beforeAll(async () => {
    // The CLI reports canonical roots. Canonicalize temporary aliases such as macOS /var
    // (-> /private/var) and Windows 8.3 short names (C:\Users\RUNNER~1) before comparing.
    project = await realpath(await mkdtemp(join(tmpdir(), 'forge-project-')));
    bundle = await realpath(await mkdtemp(join(tmpdir(), 'forge-bundle-')));
    await cp(distribution, join(bundle, 'bin'), { recursive: true });
    // Repository-local self-management is not part of a generic distribution.
    await copyFile(join(bundle, 'bin/config/default.json'), join(bundle, 'bin/config.json'));
    await rm(join(bundle, 'bin/data/context.json'), { force: true });
    await writeFile(join(bundle, 'package.json'), '{"type":"module"}');
  });
  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
    await rm(bundle, { recursive: true, force: true });
  });
  /**
   * Run the copied CLI without blocking the test worker: an event loop kept busy by synchronous child processes
   * delays the worker's RPC with Vitest past its 60 s limit. `env` adds variables such as a connector token, and an
   * in-process fake server can answer the CLI's requests while it runs.
   */
  async function cli(args: string[], input?: string | Buffer, invocation: Invocation = {}): Promise<CliResult> {
    const root = invocation.root === undefined ? project : invocation.root;
    const entry = invocation.entry ?? join(bundle, 'bin/forge.js');
    const result = await run([entry, ...(root === null ? [] : ['--root', root]), '--json', ...args], invocation.cwd ?? project, input, invocation.env);
    expect(result.stderr).toBe('');
    return { status: result.status, body: JSON.parse(result.stdout), stdout: result.stdout };
  }
  return { get project() { return project; }, get bundle() { return bundle; }, cli };
}
