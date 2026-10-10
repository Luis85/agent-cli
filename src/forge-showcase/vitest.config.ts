import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Classification patterns define the full scope; Vitest defaults hide cypress/dist directories.
    projects: [
      { test: { name: 'unit', environment: 'node', exclude: [], include: ['tests/**/*.unit.test.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'] } },
      { test: { name: 'integration', environment: 'node', exclude: [], include: ['tests/**/*.integration.test.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'] } },
      { test: { name: 'e2e', environment: 'node', exclude: [], include: ['tests/**/*.e2e.test.{ts,mts,cts,tsx,js,mjs,cjs,jsx}'] } },
    ],
  },
});
