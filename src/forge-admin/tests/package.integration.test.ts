import { afterEach, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  await writeFile(join(root, 'dist/manifest.json'), JSON.stringify({ id: 'admin', entry: 'index.html' }));
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
