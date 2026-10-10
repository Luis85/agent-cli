import { expect, it } from 'vitest';
import { vaultCommand } from '../support/vault-check.ts';

/**
 * The Forge's own documentation vault: the project README, the Diátaxis docs (with the worked examples and authored
 * templates) and the authored skills, checked from the project root as `vault check --strict --path …` would be.
 * Excluded, as documented in docs/how-to/develop-and-test.md: `src/README.md` and `tests/README.md` link folders for
 * GitHub navigation, which Obsidian cannot resolve, and `tests/` holds fixture vaults with deliberate broken links.
 */
const docsVault = '{README.md,docs/**,skills/**}';

it('keeps The Forge documentation vault free of error findings', async () => {
  const { check } = await vaultCommand(process.cwd());
  const result = await check({ path: docsVault, strict: true });
  expect(result.summary.error).toBe(0);
  expect(result.summary.files).toBeGreaterThan(70);
  expect(result.skipped).toEqual([]);
});
