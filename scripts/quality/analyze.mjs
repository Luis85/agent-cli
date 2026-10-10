import { sourceFiles, runTool, finish } from './shared.mjs';

const errors = [];
let report;
let scope;
try {
  scope = sourceFiles();
  const config = ['--config', 'configs/quality/fallow.json'];
  const discovery = runTool('fallow', ['--format', 'json', 'list', '--files', ...config]);
  if (discovery.status !== 0 || !Array.isArray(discovery.report.files)) throw new Error('Fallow source discovery failed');
  // The inventory uses POSIX separators on every platform; compare Windows reports the same way.
  const discovered = new Set(discovery.report.files.map(file => String(file).replaceAll('\\', '/')));
  const omitted = scope.filter(file => !discovered.has(file));
  if (omitted.length > 0) errors.push(`Fallow skipped source files: ${omitted.join(', ')}`);
  const result = runTool('fallow', ['--format', 'json', '--no-cache', '--max-file-size', '0', 'dead-code', ...config]);
  report = result.report;
  if (result.status !== 0) errors.push(`Fallow exited ${result.status}`);
  if (report.kind !== 'dead-code' || report.version !== '3.31.0' || report.schema_version !== 9) errors.push('Unsupported fallow report contract; review the wrapper when upgrading');
  for (const name of ['parse-error', 'error-severity-findings']) {
    const gate = report.gate_outcomes?.[name];
    if (gate?.enforced !== true || gate.status !== 'pass') errors.push(`Required gate ${name} is missing, unenforced, or failing`);
  }
  for (const [name, gate] of Object.entries(report.gate_outcomes ?? {})) {
    if (gate.enforced && gate.status !== 'pass') errors.push(`Enforced gate ${name} did not pass`);
  }
} catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
finish('fallow', errors, report, scope);
