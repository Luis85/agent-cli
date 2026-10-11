import { afterAll, expect, it } from 'vitest';
import { mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { portableCli } from '../support/portable-cli.ts';

const fixture = portableCli();
const temporary: string[] = [];
afterAll(async () => { await Promise.all(temporary.map(path => rm(path, { recursive: true, force: true }))); });

/**
 * A fresh directory that the CLI's Node process sees as the OS temporary directory on every platform. The developer's
 * own compile cache settings are removed, so only the launcher decides where and whether Node caches.
 */
async function temporaryRoot() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'forge-compile-cache-')));
  temporary.push(path);
  return { path, env: { TMPDIR: path, TEMP: path, TMP: path, NODE_COMPILE_CACHE: undefined, NODE_DISABLE_COMPILE_CACHE: undefined } };
}

/** Every cache file below `directory` with its size and modification time. */
async function cacheFiles(directory: string) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
    const path = join(entry.parentPath, entry.name), { size, mtimeMs } = await stat(path);
    return { path, size, mtimeMs };
  }));
}

it('caches the compiled runtime bundle outside the workspace and reuses it on the next invocation', async () => {
  const temp = await temporaryRoot();
  const before = await readdir(fixture.project);
  expect((await fixture.cli(['--version'], undefined, { env: temp.env })).status).toBe(0);
  // Node keeps the cache in its own folder below the temporary directory, keyed by Node version and file content.
  expect(await readdir(temp.path)).toEqual(['node-compile-cache']);
  const first = await cacheFiles(join(temp.path, 'node-compile-cache'));
  // The launcher is tiny; an entry this large is the runtime bundle, compiled only when caching starts before it loads.
  const bundle = first.find(file => file.size > 100_000);
  expect(bundle, JSON.stringify(first)).toBeDefined();
  expect((await fixture.cli(['--version'], undefined, { env: temp.env })).status).toBe(0);
  // A reused entry stays as written; a rejected one would be compiled and written again.
  expect((await cacheFiles(join(temp.path, 'node-compile-cache'))).find(file => file.path === bundle!.path)).toEqual(bundle);
  expect(await readdir(fixture.project)).toEqual(before);
});

it('leaves no cache when Node compile caching is disabled', async () => {
  const temp = await temporaryRoot();
  expect((await fixture.cli(['--version'], undefined, { env: { ...temp.env, NODE_DISABLE_COMPILE_CACHE: '1' } })).status).toBe(0);
  expect(await readdir(temp.path)).toEqual([]);
});
