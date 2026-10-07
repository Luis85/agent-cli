import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;

// Inventory explicitly, independent of .gitignore and analyzer discovery defaults.
export function sourceFiles(root = process.cwd()) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) throw new Error(`Source scope contains a symbolic link: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (sourceExtension.test(path)) files.push(path);
    }
  }
  const entries = readdirSync(root, { withFileTypes: true });
  if (!entries.some(entry => entry.name === 'src' && entry.isDirectory())) throw new Error('Required source directory src is missing');
  for (const entry of entries) {
    if (['src', 'tests', 'scripts', 'examples'].includes(entry.name)) {
      if (!entry.isDirectory()) throw new Error(`Expected source directory: ${entry.name}`);
      visit(entry.name);
    } else if (entry.isFile() && sourceExtension.test(entry.name)) files.push(entry.name);
  }
  if (!files.some(file => file.startsWith('src/'))) throw new Error('Source inventory is empty');
  return files.sort();
}

export function runTool(name, args) {
  // Both pinned packages ship Node launchers. Avoid a shell (including Windows
  // .cmd shims) so spaces and metacharacters in project filenames stay literal.
  const command = resolve('node_modules', name, 'bin', name);
  const result = spawnSync(process.execPath, [command, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.signal || result.status === null) throw new Error(`${name} did not finish normally`);
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error(`${name} did not return valid JSON (exit ${result.status}): ${result.stderr || result.stdout}`); }
  return { status: result.status, report, stderr: result.stderr };
}

export function finish(tool, errors, report, scope) {
  const result = { tool, ok: errors.length === 0, errors, scope, report };
  mkdirSync('.quality-reports', { recursive: true });
  writeFileSync(`.quality-reports/${tool}.json`, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
