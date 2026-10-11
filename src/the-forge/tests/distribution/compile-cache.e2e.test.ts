import { afterAll, expect, it } from 'vitest';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const temporary: string[] = [];
afterAll(async () => { await Promise.all(temporary.map(path => rm(path, { recursive: true, force: true }))); });

/** A fresh directory that the CLI's Node process sees as the OS temporary directory on every platform. */
async function temporaryRoot() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'forge-compile-cache-')));
  temporary.push(path);
  return { path, env: { TMPDIR: path, TEMP: path, TMP: path } };
}

it('reuses compiled code across invocations from a cache outside the workspace', async () => {
  const temp = await temporaryRoot();
  const before = await readdir(fixture.project);
  for (let call = 0; call < 2; call++) expect((await fixture.cli(['--version'], undefined, { env: temp.env })).status).toBe(0);
  // Node keeps the cache in its own folder below the temporary directory, keyed by Node version and file content.
  expect(await readdir(temp.path)).toEqual(['node-compile-cache']);
  expect((await readdir(join(temp.path, 'node-compile-cache'), { recursive: true })).length).toBeGreaterThan(0);
  expect(await readdir(fixture.project)).toEqual(before);
});

it('leaves no cache when Node compile caching is disabled', async () => {
  const temp = await temporaryRoot();
  expect((await fixture.cli(['--version'], undefined, { env: { ...temp.env, NODE_DISABLE_COMPILE_CACHE: '1' } })).status).toBe(0);
  expect(await readdir(temp.path)).toEqual([]);
});
