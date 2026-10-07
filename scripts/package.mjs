import { mkdir, copyFile, writeFile, readFile, chmod, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
await mkdir('bin/app', { recursive: true });
await writeFile('bin/app/package.json', JSON.stringify({ name: 'agent-cli-bundle', version: '0.1.0', private: true, main: 'app.cjs' }, null, 2) + '\n');
await chmod('bin/app/app.cjs', 0o755);
await copyFile('LICENSE', 'bin/app/LICENSE');
await copyFile('README.md', 'bin/app/README.md');
await cp('docs', 'bin/app/docs', { recursive: true });
await cp('skills', 'bin/app/skills', { recursive: true });
await cp('examples', 'bin/app/examples', { recursive: true });
await mkdir('bin/app/licenses', { recursive: true });
await copyFile('node_modules/yaml/LICENSE', 'bin/app/licenses/yaml-LICENSE');
await writeFile('bin/app/THIRD-PARTY-NOTICES.md', '# Bundled dependencies\n\nYAML by Eemeli Aro, ISC license. See licenses/yaml-LICENSE.\n');
// Ship type-only SDK declarations; runtime plugins need no package imports.
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.sdk.json'], { stdio: 'inherit' });
const bundle = await readFile('bin/app/app.cjs', 'utf8');
if (/require\(["']yaml["']\)/.test(bundle)) throw new Error('YAML was not bundled');
