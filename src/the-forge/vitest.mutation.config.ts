import { defineConfig } from 'vitest/config';
import suite from './vitest.config.ts';

/**
 * Mutation testing (`npm run mutate`, configured in stryker.config.json) runs only the unit level.
 * Integration and end-to-end tests start processes and locate the workspace bin/ from the project directory, which
 * Stryker's sandbox copy cannot provide. Reusing the suite's own `unit` project keeps its include pattern and budgets
 * identical to `npm test`; `npm test` itself never reads this file.
 */
const unit = suite.test?.projects?.find(project => typeof project === 'object' && 'test' in project && project.test?.name === 'unit');
if (typeof unit !== 'object' || !('test' in unit)) throw new Error('vitest.config.ts must declare an inline unit project');

export default defineConfig({ test: unit.test });
