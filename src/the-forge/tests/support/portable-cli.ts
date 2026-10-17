import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyGenericBundle, removal, sharedBundle, type SharedBundle } from './portable-bundle.ts';

/**
 * `env` adds variables to the test process's environment; an undefined value removes that variable. The working
 * directory is `cwd`, else the selected root (as for an agent working in its workspace), else the project. `timeout`
 * bounds the call in milliseconds (default 30 s).
 */
interface Invocation { root?: string | null; entry?: string; cwd?: string; env?: Record<string, string | undefined>; timeout?: number }
interface CliResult { status: number | null; body: any; stdout: string }

/** A call that runs longer is killed and fails with its arguments, instead of hanging until the test times out. */
const callTimeoutMs = 30_000;
/** Copying a private bundle creates hundreds of files, which Windows runners create far more slowly than Linux. */
const setupTimeoutMs = 180_000;
const teardownTimeoutMs = 60_000;
/** How long teardown waits for a killed child to close its output before removing the folders anyway. */
const closeTimeoutMs = 10_000;

/** Children still running when their test or hook ends; killing them keeps a hung child from outliving its test. */
const running = new Set<ChildProcess>();
async function killRunning() {
  const children = [...running];
  running.clear();
  await Promise.all(children.map(child => new Promise<void>(resolve => {
    const timer = setTimeout(resolve, closeTimeoutMs);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    child.kill();
  })));
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
  /** Milliseconds before the child is killed and the call fails with its arguments (default 30 s). */
  timeout?: number;
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
    const timeout = options.timeout ?? callTimeoutMs;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`node ${args.join(' ')} did not finish within ${timeout} ms (cwd ${options.cwd})`));
    }, timeout);
    if (out === 'first-chunk') child.stdout!.once('data', (chunk: Buffer) => { received = chunk.length; child.stdout!.destroy(); });
    else if (out === 'unread') child.stdout!.destroy();
    else child.stdout?.on('data', (chunk: Buffer) => { received += chunk.length; stdout.push(chunk); });
    if (options.closeStderr) child.stderr.destroy();
    else child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    // A command that does not read its input may exit first: POSIX reports EPIPE, Windows EOF.
    child.stdin.on('error', () => {});
    child.on('error', error => {
      clearTimeout(timer);
      running.delete(child);
      reject(new Error(`node ${args.join(' ')} failed to start in ${options.cwd}: ${error.message}`, { cause: error }));
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      running.delete(child);
      resolve({ status, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), received });
    });
    child.stdin.end(options.input);
  });
}

/**
 * Exercise a copied distribution under an ESM host with no installed packages. Files share one read-only generic copy
 * of each build; `privateBundle` gives a file its own copy to change, such as removing or rewriting `bin/` files.
 */
export function portableCli(options: { privateBundle?: boolean } = {}) {
  let project: string | undefined, bundle: string | undefined, shared: SharedBundle | undefined;
  const ready = (path: string | undefined) => {
    if (path === undefined) throw new Error('The portable CLI is used before its beforeAll hook prepared it.');
    return path;
  };
  beforeAll(async () => {
    // The CLI reports canonical roots. Canonicalize temporary aliases such as macOS /var
    // (-> /private/var) and Windows 8.3 short names (C:\Users\RUNNER~1) before comparing.
    project = await realpath(await mkdtemp(join(tmpdir(), 'forge-project-')));
    if (options.privateBundle) {
      bundle = await realpath(await mkdtemp(join(tmpdir(), 'forge-bundle-')));
      await copyGenericBundle(bundle);
    } else {
      shared = await sharedBundle();
      bundle = shared.root;
    }
  }, setupTimeoutMs);
  afterEach(killRunning);
  afterAll(async () => {
    await killRunning();
    // A setup that failed early leaves later paths unset; its own error is the one to report.
    if (project !== undefined) await rm(project, removal);
    if (options.privateBundle && bundle !== undefined) await rm(bundle, removal);
    await shared?.verify();
  }, teardownTimeoutMs);
  /**
   * Run the copied CLI without blocking the test worker: an event loop kept busy by synchronous child processes
   * delays the worker's RPC with Vitest past its 60 s limit. `env` adds variables such as a connector token, and an
   * in-process fake server can answer the CLI's requests while it runs.
   */
  async function cli(args: string[], input?: string | Buffer, invocation: Invocation = {}): Promise<CliResult> {
    const root = invocation.root === undefined ? ready(project) : invocation.root;
    const entry = invocation.entry ?? join(ready(bundle), 'bin/forge.js');
    const result = await runNode([entry, ...(root === null ? [] : ['--root', root]), '--json', ...args], { cwd: invocation.cwd ?? root ?? ready(project), input, env: invocation.env, timeout: invocation.timeout });
    expect(result.stderr).toBe('');
    return { status: result.status, body: JSON.parse(result.stdout), stdout: result.stdout };
  }
  /** Run the copied CLI on the project with raw `args`, keeping its exit signal, standard error and transport `options`. */
  function spawnCli(args: string[], processOptions: Omit<NodeProcessOptions, 'cwd'> = {}): Promise<NodeProcessResult> {
    return runNode([join(ready(bundle), 'bin/forge.js'), '--root', ready(project), ...args], { cwd: ready(project), ...processOptions });
  }
  return { get project() { return ready(project); }, get bundle() { return ready(bundle); }, cli, spawnCli };
}
