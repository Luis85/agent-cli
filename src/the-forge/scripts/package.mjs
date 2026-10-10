import { mkdir, copyFile, writeFile, readFile, readdir, chmod, cp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import distributionPolicy from '../configs/distribution-policy.json' with { type: 'json' };
const { version, engines, config } = JSON.parse(await readFile('package.json', 'utf8'));
// package.json config.distribution names the workspace bin directory; the workspace owns LICENSE.
const bin = resolve(config.distribution);
const workspace = dirname(bin);
await mkdir(join(bin, 'data'), { recursive: true });
// The local CommonJS boundary lets forge.js run in projects declaring type:module.
await writeFile(join(bin, 'package.json'), JSON.stringify({ name: 'forge-bundle', version, private: true, type: 'commonjs', main: 'forge.js', engines }, null, 2) + '\n');
try { await copyFile(join(bin, 'config/default.json'), join(bin, 'config.json'), constants.COPYFILE_EXCL); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
for (const directory of ['plugins', 'templates']) {
  await mkdir(join(bin, directory), { recursive: true });
  await writeFile(join(bin, directory, '.gitkeep'), '');
}
await chmod(join(bin, 'forge.js'), 0o755);
await copyFile(join(workspace, 'LICENSE'), join(bin, 'data/LICENSE'));
const readme = await readFile('README.md', 'utf8');
await writeFile(join(bin, 'data/README.md'), readme.replaceAll('(skills/', '(../skills/'));
const ownedDirectories = ['docs', 'licenses', 'types'];
// Replace only generated assets. User data (especially context.json), plugins,
// templates and configuration survive rebuilds.
for (const directory of [...ownedDirectories, 'skills', 'examples']) await rm(join(bin, 'data', directory), { recursive: true, force: true });
await rm(join(bin, 'skills'), { recursive: true, force: true });
await cp('skills', join(bin, 'skills'), { recursive: true });
// Research notes are planning material for maintainers, not product documentation.
await cp('docs', join(bin, 'data/docs'), { recursive: true, filter: source => resolve(source) !== resolve('docs/research') });
const docsIndex = await readFile(join(bin, 'data/docs/index.md'), 'utf8');
await writeFile(join(bin, 'data/docs/index.md'), docsIndex.replaceAll('(../skills/', '(../../skills/'));
await mkdir(join(bin, 'data/licenses'), { recursive: true });
// npm's lock marks the complete production dependency tree, including transitive
// packages. Preserve their notices even when Rollup can remove part of a package.
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = ['# Runtime dependency notices', '', 'Includes direct and transitive runtime dependencies; unused code may be removed from the executable during bundling.', ''];
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  if (!path.startsWith('node_modules/') || entry.dev) continue;
  const dependency = JSON.parse(await readFile(`${path}/package.json`, 'utf8'));
  const files = (await readdir(path, { withFileTypes: true })).filter(file => file.isFile() && /^(licen[sc]e|copying|notice)(?:[._-]|$)/i.test(file.name));
  // format 0.2.2 publishes its copyright and MIT declaration only in Readme.md.
  // Preserve that source notice together with the referenced MIT terms.
  if (dependency.name === 'format' && dependency.version === '0.2.2' && !files.length) {
    await copyFile(`${path}/Readme.md`, join(bin, 'data/licenses/format-Readme.md'));
    await copyFile('scripts/licenses/format-LICENSE', join(bin, 'data/licenses/format-LICENSE'));
    notices.push('## format 0.2.2', '', 'License: MIT. [Original notice](licenses/format-Readme.md); [license terms](licenses/format-LICENSE).', '');
    continue;
  }
  if (!files.length) throw new Error(`Missing license notice for runtime dependency ${dependency.name}`);
  notices.push(`## ${dependency.name} ${dependency.version}`, '', `License: ${dependency.license ?? entry.license ?? 'see notice'}.`, '');
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const destination = `${path.replaceAll('/', '__')}-${file.name}`;
    await copyFile(`${path}/${file.name}`, join(bin, 'data/licenses', destination));
    notices.push(`- [${file.name}](licenses/${destination})`);
  }
  notices.push('');
}
await writeFile(join(bin, 'data/THIRD-PARTY-NOTICES.md'), notices.join('\n'));
// Ship type-only SDK declarations; runtime plugins need no package imports.
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.sdk.json', '--outDir', join(bin, 'data/types')], { stdio: 'inherit' });
const files = [...distributionPolicy.requiredAssets, 'data/LICENSE', 'data/README.md', 'data/THIRD-PARTY-NOTICES.md'];
async function collect(directory) {
  for (const entry of await readdir(join(bin, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Distribution asset is not a regular file: ${path}`);
  }
}
for (const directory of ownedDirectories) await collect(`data/${directory}`);
await collect('skills');
await writeFile(join(bin, 'data/distribution.json'), JSON.stringify({ schemaVersion: distributionPolicy.schemaVersion, files: files.sort() }, null, 2) + '\n');
const bundle = await readFile(join(bin, 'forge.js'), 'utf8');
if (/require\(["']yaml["']\)/.test(bundle)) throw new Error('YAML was not bundled');
