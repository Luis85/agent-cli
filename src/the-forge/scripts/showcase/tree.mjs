import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Untracked outputs of the showcase's own toolchain; never part of the generated tree. */
const toolchainOutputs = new Set(['node_modules', 'dist', 'demo-dist', 'coverage', '.fallow', '.quality-reports']);

/** Sorted POSIX paths of every file below root, skipping toolchain outputs. @param {string} root */
export function listFiles(root) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} directory @param {string} prefix */
  function visit(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (toolchainOutputs.has(entry.name)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Unexpected non-regular file in the showcase: ${path}`);
    }
  }
  visit(root, '');
  return files.sort();
}

/**
 * Compare a freshly generated tree with the committed one.
 * @param {string} expectedRoot @param {string} actualRoot @param {readonly string[]} excluded
 * @returns {{ path: string, status: 'missing' | 'unexpected' | 'changed' }[]}
 */
export function compareTrees(expectedRoot, actualRoot, excluded) {
  const expected = listFiles(expectedRoot).filter(path => !excluded.includes(path));
  /** @type {string[]} */
  let actual = [];
  try { actual = listFiles(actualRoot).filter(path => !excluded.includes(path)); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  /** @type {{ path: string, status: 'missing' | 'unexpected' | 'changed' }[]} */
  const differences = [];
  for (const path of expected) {
    if (!actualSet.has(path)) differences.push({ path, status: 'missing' });
    else if (!readFileSync(join(expectedRoot, path)).equals(readFileSync(join(actualRoot, path)))) differences.push({ path, status: 'changed' });
  }
  for (const path of actual) if (!expectedSet.has(path)) differences.push({ path, status: 'unexpected' });
  return differences.sort((left, right) => left.path.localeCompare(right.path));
}

/** Total file count and bytes of a tree. @param {string} root */
export function treeSize(root) {
  const files = listFiles(root);
  return { files: files.length, bytes: files.reduce((total, path) => total + statSync(join(root, path)).size, 0) };
}

/**
 * The lockfile is produced by npm, not by the CLI. Check that it still
 * describes the generated package manifest's name and direct dependencies.
 * @param {string} manifestText @param {string} lockText
 * @returns {string[]} problems
 */
export function lockfileProblems(manifestText, lockText) {
  const manifest = JSON.parse(manifestText);
  /** @type {any} */
  let lock;
  try { lock = JSON.parse(lockText); }
  catch { return ['package-lock.json is not valid JSON']; }
  const root = lock?.packages?.[''];
  if (!root) return ['package-lock.json has no root package entry'];
  const problems = [];
  if (lock.name !== manifest.name || root.name !== manifest.name) problems.push('package-lock.json names a different package');
  for (const field of ['dependencies', 'devDependencies']) {
    if (JSON.stringify(sorted(root[field])) !== JSON.stringify(sorted(manifest[field]))) problems.push(`package-lock.json ${field} differ from package.json`);
  }
  return problems;
}

/** @param {Record<string, string> | undefined} value */
function sorted(value) {
  return Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}
