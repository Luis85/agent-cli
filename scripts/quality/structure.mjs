import { sourceFiles, finish } from './shared.mjs';

const errors = [];
const report = { violations: [] };
let scope;
try {
  scope = sourceFiles();
  for (const path of scope) {
    const isTest = /\.(?:test|spec)\.[^.]+$/.test(path);
    if (isTest && !/\.(?:unit|integration|e2e)\.test\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) {
      report.violations.push({ path, rule: 'test-pyramid', expected: '*.unit.test.ts, *.integration.test.ts, or *.e2e.test.ts' });
    }
    if (isTest && !path.startsWith('tests/')) report.violations.push({ path, rule: 'test-location', expected: 'Place tests under tests/ so every test is discovered by Vitest' });
  }
  if (report.violations.length > 0) errors.push('Resolve test-pyramid violations before continuing');
} catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
finish('structure', errors, report, scope);
