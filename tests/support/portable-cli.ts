import { afterAll, beforeAll, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

interface Invocation { root?: string | null; entry?: string; cwd?: string }

/** Exercise a copied distribution under an ESM host with no installed packages. */
export function portableCli() {
  let project: string, bundle: string;
  beforeAll(async () => {
    project = await mkdtemp(join(tmpdir(), 'forge-project-'));
    bundle = await mkdtemp(join(tmpdir(), 'forge-bundle-'));
    await cp(resolve('bin'), join(bundle, 'bin'), { recursive: true });
    await writeFile(join(bundle, 'package.json'), '{"type":"module"}');
  });
  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
    await rm(bundle, { recursive: true, force: true });
  });
  function cli(args: string[], input?: string | Buffer, invocation: Invocation = {}) {
    const root = invocation.root === undefined ? project : invocation.root;
    const result = spawnSync(process.execPath, [invocation.entry ?? join(bundle, 'bin/app.js'), ...(root === null ? [] : ['--root', root]), '--json', ...args], {
      cwd: invocation.cwd ?? project, encoding: 'utf8', input, timeout: 10000, env: { ...process.env, NODE_PATH: '' },
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    return { status: result.status, body: JSON.parse(result.stdout), stdout: result.stdout };
  }
  return { get project() { return project; }, get bundle() { return bundle; }, cli };
}
