import { sourceFiles, runTool, finish } from './shared.mjs';

/** Windows refuses command lines over 32,767 characters, so large scopes reach Oxlint in batches below that. */
const batchCharacters = 24_000;

/** @param {string[]} files @returns {string[][]} */
function batches(files) {
  /** @type {string[][]} */
  const result = [];
  let current = [], length = 0;
  for (const file of files) {
    if (current.length > 0 && length + file.length + 1 > batchCharacters) { result.push(current); current = []; length = 0; }
    current.push(file); length += file.length + 1;
  }
  if (current.length > 0) result.push(current);
  return result;
}

/** @type {string[]} */
const errors = [];
let report;
let scope;
try {
  // Oxlint does not lint declarations; TypeScript and fallow validate those files.
  scope = sourceFiles().filter(file => !/\.d\.[cm]?ts$/.test(file));
  /** @type {unknown[]} */
  const diagnostics = [];
  let linted = 0;
  for (const batch of batches(scope)) {
    const result = runTool('oxlint', ['--config', 'configs/lint/oxlintrc.json', '--no-ignore', '--deny-warnings', '--format', 'json', ...batch]);
    report = result.report;
    if (result.status !== 0 && !errors.includes(`Oxlint exited ${result.status}`)) errors.push(`Oxlint exited ${result.status}`);
    if (!Array.isArray(report.diagnostics)) { errors.push('Missing lint diagnostics'); continue; }
    diagnostics.push(...report.diagnostics);
    linted += report.number_of_files;
  }
  // The saved report combines every batch, as if one Oxlint run had linted the whole scope.
  report = { ...report, diagnostics, number_of_files: linted };
  if (diagnostics.length > 0) errors.push('Lint findings must be resolved');
  if (linted !== scope.length) errors.push(`Incomplete lint scope: expected ${scope.length} files, received ${linted}`);
} catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
finish('oxlint', errors, report, scope);
