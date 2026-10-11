import { defineConfig } from 'vitest/config';

const extensions = '{ts,mts,cts,tsx,js,mjs,cjs,jsx}';

/**
 * Each pyramid level states its own budgets, so a focused `vitest run <file>` behaves exactly like `npm test`.
 * Integration and end-to-end tests start real processes and toolchains, which Windows runners create much more
 * slowly than Linux; a test that needs more declares it next to its workflow.
 */
const levels = [
  { name: 'unit', testTimeout: 30_000, hookTimeout: 30_000 },
  { name: 'integration', testTimeout: 30_000, hookTimeout: 30_000 },
  { name: 'e2e', testTimeout: 30_000, hookTimeout: 30_000 },
];

export default defineConfig({
  test: {
    // Classification patterns define the full scope; Vitest defaults hide cypress/dist directories.
    projects: levels.map(({ name, testTimeout, hookTimeout }) => ({
      test: { name, environment: 'node', exclude: [], include: [`tests/**/*.${name}.test.${extensions}`], testTimeout, hookTimeout },
    })),
  },
});
