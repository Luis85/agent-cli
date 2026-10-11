import { afterAll, beforeAll, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distribution } from './workspace.ts';

interface Invocation { root?: string | null; entry?: string; cwd?: string }

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
  function cli(args: string[], input?: string | Buffer, invocation: Invocation = {}) {
    const root = invocation.root === undefined ? project : invocation.root;
    const result = spawnSync(process.execPath, [invocation.entry ?? join(bundle, 'bin/forge.js'), ...(root === null ? [] : ['--root', root]), '--json', ...args], {
      cwd: invocation.cwd ?? project, encoding: 'utf8', input, timeout: 30_000, env: { ...process.env, NODE_PATH: '' },
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    return { status: result.status, body: JSON.parse(result.stdout), stdout: result.stdout };
  }
  /**
   * The same invocation without blocking the test process, so an in-process fake server can answer the CLI's
   * requests; `env` adds variables such as a connector token.
   */
  function cliAsync(args: string[], env: Record<string, string> = {}) {
    return new Promise<{ status: number | null; body: any; stdout: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [join(bundle, 'bin/forge.js'), '--root', project, '--json', ...args], { cwd: project, env: { ...process.env, NODE_PATH: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [], stderr: Buffer[] = [];
      child.stdout.on('data', chunk => stdout.push(chunk as Buffer));
      child.stderr.on('data', chunk => stderr.push(chunk as Buffer));
      child.on('error', reject);
      child.on('close', status => {
        expect(Buffer.concat(stderr).toString('utf8')).toBe('');
        const text = Buffer.concat(stdout).toString('utf8');
        resolve({ status, body: JSON.parse(text), stdout: text });
      });
    });
  }
  return { get project() { return project; }, get bundle() { return bundle; }, cli, cliAsync };
}
