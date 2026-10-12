import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { notices } from '../scripts/notices';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'forge-admin-notices-'));
  temporary.push(root);
  for (const name of ['sample', 'unused', 'tailwindcss', '@iconify-json/lucide']) {
    const directory = join(root, 'node_modules', name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT', type: 'module', exports: './dist/index.js' }));
    if (name !== '@iconify-json/lucide') await writeFile(join(directory, 'LICENSE'), `License text for ${name}`);
  }
  await mkdir(join(root, 'node_modules/sample/dist'));
  await writeFile(join(root, 'node_modules/sample/dist/package.json'), '{"type":"module"}');
  await writeFile(join(root, 'node_modules/sample/dist/index.js'), 'export const example = "Included in the browser";');
  await mkdir(join(root, 'scripts/licenses'), { recursive: true });
  await writeFile(join(root, 'scripts/licenses/lucide-LICENSE'), 'Lucide and Feather license text');
  await writeFile(join(root, 'entry.js'), 'export { example } from "sample";');
  return root;
}

async function bundle(root: string) {
  const result = await build({
    configFile: false, root, logLevel: 'silent', plugins: [notices()],
    build: { write: false, minify: false, lib: { entry: join(root, 'entry.js'), formats: ['es'], fileName: 'app' } },
  });
  if ('on' in result) throw new Error('Expected a completed build.');
  return (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output).filter(asset => asset.type === 'asset');
}

it('attributes bundled code through nested module boundaries and keeps offline notices reproducible', async () => {
  const root = await fixture();
  const first = await bundle(root);
  const second = await bundle(root);
  expect(second.map(asset => [asset.fileName, asset.source])).toEqual(first.map(asset => [asset.fileName, asset.source]));
  const notice = String(first.find(asset => asset.fileName === 'THIRD-PARTY-NOTICES.md')?.source);
  expect(notice).toContain('## sample 1.0.0');
  expect(notice).toContain('## tailwindcss 1.0.0');
  expect(notice).not.toContain('## unused');
  expect(notice).not.toContain(root);
  expect(first.find(asset => asset.fileName === 'licenses/node_modules__sample__LICENSE')?.source.toString()).toBe('License text for sample');
  expect(first.find(asset => asset.fileName === 'licenses/lucide-LICENSE')?.source.toString()).toBe('Lucide and Feather license text');
});

it('fails the build instead of silently omitting a bundled dependency license', async () => {
  const root = await fixture();
  await rm(join(root, 'node_modules/sample/LICENSE'));
  await expect(bundle(root)).rejects.toThrow('Missing license notice for bundled dependency sample');
});
