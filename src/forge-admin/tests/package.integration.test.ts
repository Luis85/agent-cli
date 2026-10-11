import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'forge-admin-package-'));
  temporary.push(root);
  await mkdir(join(root, 'scripts'));
  await cp(resolve('scripts/package.mjs'), join(root, 'scripts/package.mjs'));
  for (const directory of ['dist/assets', 'bin/data', 'bin/webviews/admin/assets', 'bin/webviews/private']) await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ config: { distribution: './bin/webviews/admin' } }));
  await writeFile(join(root, 'dist/index.html'), '<html>Admin</html>');
  await writeFile(join(root, 'dist/manifest.json'), JSON.stringify({ id: 'admin', name: 'Developer admin', entry: 'index.html' }));
  await writeFile(join(root, 'dist/THIRD-PARTY-NOTICES.md'), '# Notices');
  await writeFile(join(root, 'dist/assets/new.js'), 'console.log("new")');
  await writeFile(join(root, 'bin/webviews/admin/assets/old.js'), 'old');
  await writeFile(join(root, 'bin/webviews/private/index.html'), 'private');
  await writeFile(join(root, 'bin/config.json'), '{"local":true}');
  await writeFile(join(root, 'bin/data/distribution.json'), JSON.stringify({ schemaVersion: 1, files: ['forge.js', 'webviews/admin/assets/old.js'] }));
  return root;
}

function run(root: string, check = false) {
  return execFileSync(process.execPath, ['scripts/package.mjs', ...(check ? ['--check'] : [])], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
}

it('publishes a complete view and manifest without retaining obsolete assets or changing workspace data', async () => {
  const root = await fixture();
  run(root);
  expect(await readFile(join(root, 'bin/webviews/admin/index.html'), 'utf8')).toBe('<html>Admin</html>');
  await expect(readFile(join(root, 'bin/webviews/admin/assets/old.js'))).rejects.toThrow();
  expect(await readFile(join(root, 'bin/config.json'), 'utf8')).toBe('{"local":true}');
  expect(await readFile(join(root, 'bin/webviews/private/index.html'), 'utf8')).toBe('private');
  expect(JSON.parse(await readFile(join(root, 'bin/data/distribution.json'), 'utf8')).files).toEqual([
    'forge.js', 'webviews/admin/THIRD-PARTY-NOTICES.md', 'webviews/admin/assets/new.js', 'webviews/admin/index.html', 'webviews/admin/manifest.json',
  ]);
  expect(run(root, true)).toContain('is current');
  await writeFile(join(root, 'dist/assets/new.js'), 'different');
  expect(() => run(root, true)).toThrow('Packaged admin asset differs');
  expect(await readFile(join(root, 'bin/webviews/admin/assets/new.js'), 'utf8')).toBe('console.log("new")');
});

it('refuses an incomplete view before changing the installed distribution', async () => {
  const root = await fixture();
  await rm(join(root, 'dist/THIRD-PARTY-NOTICES.md'));
  expect(() => run(root)).toThrow('Missing dist/THIRD-PARTY-NOTICES.md');
  expect(await readFile(join(root, 'bin/webviews/admin/assets/old.js'), 'utf8')).toBe('old');
});

it.each(['bin', 'bin/data', 'bin/webviews', 'bin/webviews/admin'])('rejects a linked distribution boundary in publication and check mode: %s', async path => {
  const root = await fixture();
  const target = join(root, 'external');
  await rename(join(root, path), target);
  // Directory junctions also exercise containment on Windows without requiring
  // the elevated privilege needed for file symlinks.
  await symlink(target, join(root, path), 'junction');
  if (path === 'bin') await rm(join(target, 'webviews'), { recursive: true });
  const before = await readdir(target);
  for (const check of [false, true]) expect(() => run(root, check)).toThrow('Expected a regular directory');
  expect(await readdir(target)).toEqual(before);
});

it.skipIf(process.platform === 'win32')('refuses a linked manifest before reading or replacing it', async () => {
  const root = await fixture();
  const path = join(root, 'bin/data/distribution.json');
  const original = await readFile(path, 'utf8');
  await rename(path, join(root, 'external.json'));
  await symlink(join(root, 'external.json'), path);
  for (const check of [false, true]) expect(() => run(root, check)).toThrow('manifest is not a regular file');
  expect(await readFile(join(root, 'external.json'), 'utf8')).toBe(original);
  expect(await readFile(join(root, 'bin/webviews/admin/assets/old.js'), 'utf8')).toBe('old');
});

it.each([null, { schemaVersion: 1, files: ['forge.js', 'forge.js'] }])('refuses a malformed distribution manifest without replacing the view', async manifest => {
  const root = await fixture();
  await writeFile(join(root, 'bin/data/distribution.json'), JSON.stringify(manifest));
  expect(() => run(root)).toThrow('The Forge distribution manifest is invalid');
  expect(await readFile(join(root, 'bin/webviews/admin/assets/old.js'), 'utf8')).toBe('old');
});

it.each([null, { id: 'admin', entry: 'index.html' }, { id: 'admin', name: ' ', entry: 'index.html' }])('refuses a view manifest that the server cannot discover', async manifest => {
  const root = await fixture();
  await writeFile(join(root, 'dist/manifest.json'), JSON.stringify(manifest));
  expect(() => run(root)).toThrow('The admin webview manifest is invalid');
  expect(await readFile(join(root, 'bin/webviews/admin/assets/old.js'), 'utf8')).toBe('old');
});

it('restores the previous view when the distribution manifest cannot be replaced', async () => {
  const root = await fixture();
  const original = await readFile(join(root, 'bin/data/distribution.json'), 'utf8');
  // Inject the failure at the final filesystem boundary, after installing the
  // new assets, to exercise recovery without relying on OS permission rules.
  await writeFile(join(root, 'fail-manifest.mjs'), `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.rename;
    fs.rename = async (source, destination) => {
      if (destination.replaceAll('\\\\', '/').endsWith('/data/distribution.json')) throw new Error('Simulated manifest replacement failure');
      return rename(source, destination);
    };
    syncBuiltinESMExports();
  `);
  expect(() => execFileSync(process.execPath, ['--import', join(root, 'fail-manifest.mjs'), 'scripts/package.mjs'], {
    cwd: root, encoding: 'utf8', stdio: 'pipe',
  })).toThrow('Simulated manifest replacement failure');
  expect(await readFile(join(root, 'bin/data/distribution.json'), 'utf8')).toBe(original);
  expect(await readFile(join(root, 'bin/webviews/admin/assets/old.js'), 'utf8')).toBe('old');
  await expect(readFile(join(root, 'bin/webviews/admin/assets/new.js'))).rejects.toThrow();
  expect(await readdir(join(root, 'bin/webviews'))).toEqual(['admin', 'private']);
});
