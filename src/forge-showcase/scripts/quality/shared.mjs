import { readdirSync, mkdirSync, writeFileSync, readFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** @param {string} value */
function containedPath(value) {
  // oxlint-disable-next-line no-control-regex -- Source roots must reject control characters and Windows/URL separators.
  return value.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\:\x00-\x1f]/.test(part));
}

/** @param {unknown} error */
function missing(error) { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }

/** @param {string} root */
function sourceDirectories(root) {
  const path = resolve(root, 'configs/quality/source.json');
  /** @type {unknown} */
  let config;
  try { config = JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    if (missing(error)) return { sourceRoot: 'src', additionalRoots: [] };
    throw new Error(`Cannot read source inventory configuration configs/quality/source.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) || !('sourceRoot' in config) || typeof config.sourceRoot !== 'string' || Object.keys(config).some(key => !['sourceRoot', 'additionalRoots'].includes(key))) {
    throw new Error('configs/quality/source.json requires a sourceRoot string and optional additionalRoots list.');
  }
  if (config.sourceRoot.split('/')[0] !== 'src' || !containedPath(config.sourceRoot)) {
    throw new Error('sourceRoot must be src or a contained POSIX subdirectory such as src/the-forge.');
  }
  const additional = 'additionalRoots' in config ? config.additionalRoots : [];
  if (!Array.isArray(additional) || additional.some(value => typeof value !== 'string' || !containedPath(value))) {
    throw new Error('additionalRoots must contain relative POSIX directory paths.');
  }
  /** @type {string[]} */
  const additionalRoots = additional;
  const roots = [config.sourceRoot, ...additionalRoots];
  if (roots.some((root, index) => roots.some((other, otherIndex) => index !== otherIndex && (root === other || root.startsWith(other + '/'))))) {
    throw new Error('Source inventory roots must be unique and must not contain one another.');
  }
  return { sourceRoot: config.sourceRoot, additionalRoots };
}

// Inventory explicitly, independent of .gitignore and analyzer discovery defaults.
export function sourceFiles(root = process.cwd()) {
  /** @type {string[]} */
  const files = [];
  const { sourceRoot, additionalRoots } = sourceDirectories(root);
  /** @param {string} directory */
  function visit(directory) {
    for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) throw new Error(`Source scope contains a symbolic link: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (sourceExtension.test(path)) files.push(path);
    }
  }
  const entries = readdirSync(root, { withFileTypes: true });
  for (const selected of [sourceRoot, ...additionalRoots]) {
    let directory = root;
    for (const part of selected.split('/')) {
      directory = join(directory, part);
      let entry;
      try { entry = lstatSync(directory); }
      catch (error) {
        if (missing(error)) throw new Error(`Required source directory ${selected} is missing`);
        throw error;
      }
      if (entry.isSymbolicLink()) throw new Error(`Source scope contains a symbolic link: ${selected}`);
      if (!entry.isDirectory()) throw new Error(`Expected source directory: ${selected}`);
    }
    visit(selected);
  }
  for (const entry of entries) {
    if (['tests', 'scripts', 'examples'].includes(entry.name)) {
      if (!entry.isDirectory()) throw new Error(`Expected source directory: ${entry.name}`);
      visit(entry.name);
    } else if (entry.isFile() && sourceExtension.test(entry.name)) files.push(entry.name);
  }
  if (!files.some(file => file.startsWith(sourceRoot + '/'))) throw new Error(`Source inventory is empty: ${sourceRoot}`);
  return [...new Set(files)].sort();
}

/** @param {string} name @param {string[]} args */
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

/** @param {string} tool @param {string[]} errors @param {unknown} report @param {string[] | undefined} scope */
export function finish(tool, errors, report, scope) {
  const result = { tool, ok: errors.length === 0, errors, scope, report };
  mkdirSync('.quality-reports', { recursive: true });
  writeFileSync(`.quality-reports/${tool}.json`, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
