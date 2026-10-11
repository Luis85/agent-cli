import { sourceFiles, runTool, finish } from './shared.mjs';

const errors = [];
let report;
let scope;
try {
  // Oxlint does not lint declarations; TypeScript and fallow validate those files.
  scope = sourceFiles().filter(file => !/\.d\.[cm]?ts$/.test(file));
  const result = runTool('oxlint', ['--config', 'configs/lint/oxlintrc.json', '--no-ignore', '--deny-warnings', '--format', 'json', ...scope]);
  report = result.report;
  if (result.status !== 0) errors.push(`Oxlint exited ${result.status}`);
  if (!Array.isArray(report.diagnostics)) errors.push('Missing lint diagnostics');
  else if (report.diagnostics.length > 0) errors.push('Lint findings must be resolved');
  if (report.number_of_files !== scope.length) errors.push(`Incomplete lint scope: expected ${scope.length} files, received ${report.number_of_files}`);
} catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
finish('oxlint', errors, report, scope);
