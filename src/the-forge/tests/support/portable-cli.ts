import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { copyFile, cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distribution } from './workspace.ts';

/**
 * `env` adds variables to the test process's environment; an undefined value removes that variable. The working
 * directory is `cwd`, else the selected root (as for an agent working in its workspace), else the project.
 */
interface Invocation { root?: string | null; entry?: string; cwd?: string; env?: Record<string, string | undefined> }
interface CliResult { status: number | null; body: any; stdout: string }

/**
 * Children still running when their test or hook ends. The test's own timeout (which slow workflows may raise) bounds
 * each call; killing leftovers afterwards keeps a hung child from outliving the test that started it.
 */
const running = new Set<ChildProcess>();
function killRunning() {
  for (const child of running) child.kill();
  running.clear();
}

/** How a test drives one Node child process. */
interface NodeProcessOptions {
  cwd: string;
  input?: string | Buffer;
  /** Adds variables to the test process's environment; an undefined value removes that variable. */
  env?: Record<string, string | undefined>;
  /** Node options placed before the script, such as `--require` for a fault-injecting preload. */
  nodeArgs?: string[];
  /**
   * Standard output: collected through a pipe (the default), an inherited file descriptor, or a pipe whose reader
   * closes after the first chunk (`first-chunk`, as `| head -c 10` does) or before reading anything (`unread`).
   */
  stdout?: 'pipe' | 'first-chunk' | 'unread' | number;
  /** Close the read end of standard error at once, as a harness that never reads it does. */
  closeStderr?: boolean;
}
/** The exit, the collected output and the number of standard output bytes read before any early close. */
export interface NodeProcessResult { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; received: number }

/** Start Node with `args` portably, write `input` to its standard input and collect its output. */
function runNode(args: string[], options: NodeProcessOptions): Promise<NodeProcessResult> {
  return new Promise((resolve, reject) => {
    const out = options.stdout ?? 'pipe';
    // Standard output is null when the child inherits a file descriptor.
    const child = spawn(process.execPath, [...(options.nodeArgs ?? []), ...args], {
      cwd: options.cwd, env: { ...process.env, NODE_PATH: '', ...options.env }, stdio: ['pipe', typeof out === 'number' ? out : 'pipe', 'pipe'],
    }) as ChildProcessByStdio<Writable, Readable | null, Readable>;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let received = 0;
    running.add(child);
    if (out === 'first-chunk') child.stdout!.once('data', (chunk: Buffer) => { received = chunk.length; child.stdout!.destroy(); });
    else if (out === 'unread') child.stdout!.destroy();
    else child.stdout?.on('data', (chunk: Buffer) => { received += chunk.length; stdout.push(chunk); });
    if (options.closeStderr) child.stderr.destroy();
    else child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    // A command that does not read its input may exit first: POSIX reports EPIPE, Windows EOF.
    child.stdin.on('error', () => {});
    child.on('error', error => { running.delete(child); reject(error); });
    child.on('close', (status, signal) => {
      running.delete(child);
      resolve({ status, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), received });
    });
    child.stdin.end(options.input);
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
  afterEach(killRunning);
  afterAll(async () => {
    killRunning();
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
    const result = await runNode([entry, ...(root === null ? [] : ['--root', root]), '--json', ...args], { cwd: invocation.cwd ?? root ?? project, input, env: invocation.env });
    expect(result.stderr).toBe('');
    return { status: result.status, body: JSON.parse(result.stdout), stdout: result.stdout };
  }
  /** Run the copied CLI on the project with raw `args`, keeping its exit signal, standard error and transport `options`. */
  function spawnCli(args: string[], options: Omit<NodeProcessOptions, 'cwd'> = {}): Promise<NodeProcessResult> {
    return runNode([join(bundle, 'bin/forge.js'), '--root', project, ...args], { cwd: project, ...options });
  }
  return { get project() { return project; }, get bundle() { return bundle; }, cli, spawnCli };
}
