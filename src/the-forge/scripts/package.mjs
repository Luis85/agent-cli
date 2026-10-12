import { mkdir, copyFile, writeFile, readFile, readdir, chmod, cp, rm, lstat } from 'node:fs/promises';
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
// Every command starts a new process. The launcher enables V8's compile cache before loading the runtime bundle, so
// later invocations skip compiling it again. Node keeps the cache under the OS temporary directory, never in the
// workspace, and NODE_DISABLE_COMPILE_CACHE=1 turns it off. Without the bundle, such as after an upgrade that replaced
// only forge.js, the launcher answers with the CLI's JSON envelope: the catalog's INVALID_SETUP hint and exit code
// (tests/distribution/launcher.e2e.test.ts compares them with src/domain/shared/error-catalog.ts).
const invalidSetupHint = 'Repair the bin path named in the message, then run setup again.';
await writeFile(join(bin, 'forge.js'), [
  '#!/usr/bin/env node',
  "'use strict';",
  "require('node:module').enableCompileCache();",
  "const runtime = require('node:path').join(__dirname, 'forge-runtime.js');",
  "if (require('node:fs').existsSync(runtime)) require(runtime);",
  'else {',
  '  const message = `The runtime bundle ${runtime} is missing. bin/forge.js and bin/forge-runtime.js ship together; replace both from the same release.`;',
  `  const error = { code: 'INVALID_SETUP', message, hint: ${JSON.stringify(invalidSetupHint)}, retryable: false };`,
  "  process.stdout.write(JSON.stringify({ ok: false, error, events: [], warnings: [] }, null, 2) + '\\n');",
  '  process.exitCode = 2;',
  '}',
  '',
].join('\n'));
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
  if (!files.length) throw new Error(`Missing license notice for runtime dependency ${dependency.name}`);
  notices.push(`## ${dependency.name} ${dependency.version}`, '', `License: ${dependency.license ?? entry.license ?? 'see notice'}.`, '');
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const destination = `${path.replaceAll('/', '__')}-${file.name}`;
    await copyFile(`${path}/${file.name}`, join(bin, 'data/licenses', destination));
    notices.push(`- [${file.name}](licenses/${destination})`);
  }
  notices.push('');
}
// Vendored assets are embedded in forge-runtime.js without a package; scripts/vendor-docker-agent.mjs records their source.
const dockerAgent = JSON.parse(await readFile('src/plugins/agents/infrastructure/vendor/source.json', 'utf8'));
await copyFile('scripts/licenses/docker-agent-LICENSE', join(bin, 'data/licenses/docker-agent-LICENSE'));
notices.push('# Vendored asset notices', '', `## docker-agent ${dockerAgent.files.join(', ')}`, '',
  `Copied unchanged from ${dockerAgent.repository} at commit ${dockerAgent.commit}. License: ${dockerAgent.license}.`, '', '- [LICENSE](licenses/docker-agent-LICENSE)', '');
await writeFile(join(bin, 'data/THIRD-PARTY-NOTICES.md'), notices.join('\n'));
// Playwright resolves browser descriptors, helpers and wasm relative to its own
// package. Preserve the upstream layout; the portable CLI loads it explicitly.
await rm(join(bin, 'browser-runtime/playwright-core'), { recursive: true, force: true });
await cp('node_modules/playwright-core', join(bin, 'browser-runtime/playwright-core'), { recursive: true });
// Ship type-only SDK declarations; runtime plugins need no package imports.
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.sdk.json', '--outDir', join(bin, 'data/types')], { stdio: 'inherit' });
const files = [...distributionPolicy.requiredAssets, 'data/LICENSE', 'data/README.md', 'data/THIRD-PARTY-NOTICES.md'];
async function collect(directory) {
  const parent = await lstat(join(bin, directory));
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error(`Distribution asset is not a regular directory: ${directory}`);
  for (const entry of await readdir(join(bin, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Distribution asset is not a regular file: ${path}`);
  }
}
for (const directory of ownedDirectories) await collect(`data/${directory}`);
await collect('skills');
await collect('browser-runtime/playwright-core');
// The independent admin project publishes its own prebuilt assets. Preserve that
// bundle while rebuilding Forge; never package other locally installed webviews.
await collect('webviews/admin');
for (const path of distributionPolicy.requiredAssets.filter(path => path !== 'data/distribution.json')) {
  const entry = await lstat(join(bin, path));
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Required distribution asset is not a regular file: ${path}`);
}
await writeFile(join(bin, 'data/distribution.json'), JSON.stringify({ schemaVersion: distributionPolicy.schemaVersion, files: [...new Set(files)].sort() }, null, 2) + '\n');
const bundle = await readFile(join(bin, 'forge-runtime.js'), 'utf8');
if (/require\(["']yaml["']\)/.test(bundle)) throw new Error('YAML was not bundled');
