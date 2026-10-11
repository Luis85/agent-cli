import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sourceFiles } from './shared.mjs';

let directory;
try {
  // TypeScript globs omit hidden directories and prefer .ts over same-named .js.
  // Explicit files keep every accepted test and test helper in the compiler program.
  const files = sourceFiles().filter(file => file.startsWith('tests/')).map(file => resolve(file));
  // Keep the generated config beneath the project so normal @types resolution is unchanged.
  mkdirSync('.quality-reports', { recursive: true });
  directory = mkdtempSync(resolve('.quality-reports', 'typecheck-'));
  const config = join(directory, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({ extends: resolve('tsconfig.json'), files }));
  const result = spawnSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--noEmit', '--project', config, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal || result.status === null) throw new Error('TypeScript did not finish normally');
  process.exitCode = result.status;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
