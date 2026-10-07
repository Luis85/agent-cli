import { mkdir, copyFile, writeFile, readFile, readdir, chmod, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('bin/app', { recursive: true });
const { version, engines } = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('bin/app/package.json', JSON.stringify({ name: 'forge-bundle', version, private: true, main: 'app.cjs', engines }, null, 2) + '\n');
await copyFile('config/default.json', 'bin/config.json');
await chmod('bin/app/app.cjs', 0o755);
await copyFile('LICENSE', 'bin/app/LICENSE');
await copyFile('README.md', 'bin/app/README.md');
await cp('docs', 'bin/app/docs', { recursive: true });
await cp('skills', 'bin/app/skills', { recursive: true });
await cp('examples', 'bin/app/examples', { recursive: true });
await mkdir('bin/app/licenses', { recursive: true });
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
    await copyFile(`${path}/Readme.md`, 'bin/app/licenses/format-Readme.md');
    await copyFile('scripts/licenses/format-LICENSE', 'bin/app/licenses/format-LICENSE');
    notices.push('## format 0.2.2', '', 'License: MIT. [Original notice](licenses/format-Readme.md); [license terms](licenses/format-LICENSE).', '');
    continue;
  }
  if (!files.length) throw new Error(`Missing license notice for runtime dependency ${dependency.name}`);
  notices.push(`## ${dependency.name} ${dependency.version}`, '', `License: ${dependency.license ?? entry.license ?? 'see notice'}.`, '');
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const destination = `${path.replaceAll('/', '__')}-${file.name}`;
    await copyFile(`${path}/${file.name}`, `bin/app/licenses/${destination}`);
    notices.push(`- [${file.name}](licenses/${destination})`);
  }
  notices.push('');
}
await writeFile('bin/app/THIRD-PARTY-NOTICES.md', notices.join('\n'));
// Ship type-only SDK declarations; runtime plugins need no package imports.
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.sdk.json'], { stdio: 'inherit' });
const bundle = await readFile('bin/app/app.cjs', 'utf8');
if (/require\(["']yaml["']\)/.test(bundle)) throw new Error('YAML was not bundled');
