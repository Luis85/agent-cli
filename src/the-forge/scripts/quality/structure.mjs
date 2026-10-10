import { sourceFiles, finish } from './shared.mjs';

const errors = [];
const report = { violations: [] };
let scope;
try {
  const args = process.argv.slice(2);
  const forgeLayout = args.length === 2 && args[0] === '--source-layout' && args[1] === 'forge';
  if (args.length > 0 && !forgeLayout) throw new Error('Use no arguments for portable test checks, or --source-layout forge for this repository layout.');
  scope = sourceFiles();
  for (const path of scope) {
    const isTest = /\.(?:test|spec)\.[^.]+$/.test(path);
    if (isTest && !/\.(?:unit|integration|e2e)\.test\.(?:[cm]?[jt]s|[jt]sx)$/.test(path)) {
      report.violations.push({ path, rule: 'test-pyramid', expected: '*.unit.test.ts, *.integration.test.ts, or *.e2e.test.ts' });
    }
    if (isTest && !path.startsWith('tests/')) report.violations.push({ path, rule: 'test-location', expected: 'Place tests under tests/ so every test is discovered by Vitest' });
    if (forgeLayout && path.startsWith('src/') && !['src/main.ts', 'src/sdk.ts', 'src/vite-env.d.ts'].includes(path)) {
      // Kernel source is grouped by layer, then concern; a bundled core plugin owns its layers under src/plugins/<id>/.
      const kernel = /^src\/(?:domain|application|infrastructure|presentation)\/[^/]+\/.+/.test(path);
      const corePlugin = /^src\/plugins\/[a-z][a-z0-9-]*\/(?:plugin\.ts|(?:domain|application|infrastructure|presentation)\/.+)$/.test(path);
      if (!kernel && !corePlugin) {
        report.violations.push({ path, rule: 'source-location', expected: 'Use src/<layer>/<concern>/... for the kernel and src/plugins/<id>/plugin.ts or src/plugins/<id>/<layer>/... for core plugins; only main.ts, sdk.ts and vite-env.d.ts belong at the project source root' });
      }
    }
  }
  if (report.violations.length > 0) errors.push('Resolve source organization and test-pyramid violations before continuing');
} catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
finish('structure', errors, report, scope);
